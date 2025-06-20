import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, SuggestModal, TFile, TFolder } from 'obsidian';
import OpenAI from 'openai';

export interface AutoflowPluginSettings {
	/** OpenAI or compatible API key */
	apiKey: string;
	/** Model name, e.g. gpt-4.1 */
	model: string;
	/** Embedding model name, e.g. text-embedding-3-small */
	embeddingModel: string;
	/** Sampling temperature (0-2) */
	temperature: number;
	/** Show confirmation modal before running a flow */
	showFlowConfirmation: boolean;
}

export const DEFAULT_SETTINGS: AutoflowPluginSettings = {
	apiKey: '',
	model: 'gpt-4.1',
	embeddingModel: 'text-embedding-3-small',
	temperature: 0.7,
	showFlowConfirmation: false
};

export interface FlowStep {
    type: 'search' | 'transform' | 'write';
}

export interface SearchStep extends FlowStep {
    type: 'search';
    sourceFolder: string;
    query?: string;
}

export interface TransformStep extends FlowStep {
    type: 'transform';
    prompt: string;
}

export interface WriteStep extends FlowStep {
    type: 'write';
    targetFile: string;
}

export type AnyStep = SearchStep | TransformStep | WriteStep;

export interface FlowDefinition {
    name: string;
    description: string;
    steps: AnyStep[];
}

/**
 * Parse the simplified Autoflow Markdown format introduced in Phase 9.
 * Expected structure (leading/trailing whitespace is ignored):
 *
 * autoflow
 * name: Example Name
 * description: "..."
 * steps:
 * type: search
 * - sourceFolder: "Folder"
 * - query: "something"
 * type: transform
 * - prompt: "..."
 * type: write
 * - targetFile: "path"
 */
export function parseSimpleFlowDefinition(text: string): FlowDefinition | Error {
    const lines = text.split(/\r?\n/).map(l => l.trim());

    // Filter out empty comment lines if any
    const nonEmpty = lines.filter(l => l.length > 0 && !l.startsWith('<!--'));

    if (nonEmpty.length === 0) {
        return new Error('Empty flow definition.');
    }

    if (nonEmpty[0].toLowerCase() !== 'autoflow') {
        return new Error('Not a simple Autoflow definition.');
    }

    let idx = 1;
    const topLevel: Record<string, string> = {};
    const steps: AnyStep[] = [];

    // Helper to parse "key: value" pairs (with optional leading dash)
    const kvRegex = /^-?\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/;

    // Parse top-level keys until we hit "steps:" line or end
    while (idx < nonEmpty.length) {
        const line = nonEmpty[idx];
        if (/^steps\s*:/.test(line)) {
            idx++;
            break;
        }

        const kvMatch = line.match(kvRegex);
        if (!kvMatch) {
            return new Error(`Invalid top-level line: ${line}`);
        }
        const [, key, value] = kvMatch;
        topLevel[key] = value.replace(/^"|"$/g, '');
        idx++;
    }

    let currentStep: Record<string, string> | null = null;

    while (idx < nonEmpty.length) {
        const line = nonEmpty[idx];
        if (line.startsWith('type')) {
            // Save previous step if present
            if (currentStep) {
                steps.push(currentStep as unknown as AnyStep);
            }

            const kvMatch = line.match(kvRegex);
            if (!kvMatch) {
                return new Error(`Invalid step type line: ${line}`);
            }
            const [, , value] = kvMatch;
            currentStep = { type: value.replace(/^"|"$/g, '') };
        } else {
            if (!currentStep) {
                return new Error(`Parameter specified before step type: ${line}`);
            }
            const kvMatch = line.match(kvRegex);
            if (!kvMatch) {
                return new Error(`Invalid parameter line: ${line}`);
            }
            const [, key, value] = kvMatch;
            currentStep[key] = value.replace(/^"|"$/g, '');
        }

        idx++;
    }

    // Push last step if exists
    if (currentStep) {
        steps.push(currentStep as unknown as AnyStep);
    }

    if (!topLevel['name'] || !topLevel['description']) {
        return new Error('Simple flow must have name and description.');
    }

    if (steps.length === 0) {
        return new Error('Simple flow must include at least one step.');
    }

    return {
        name: topLevel['name'],
        description: topLevel['description'],
        steps
    } as FlowDefinition;
}

export function parseFlowDefinition(text: string): FlowDefinition | Error {
    return parseSimpleFlowDefinition(text);
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
        return -1;
    }
    const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
    const magA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0));
    const magB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0));
    if (magA === 0 || magB === 0) {
        return 0;
    }
    return dotProduct / (magA * magB);
}

export interface EmbeddingIndex {
    [filePath: string]: {
        embedding: number[];
        mtime: number;
    };
}

export default class AutoflowPlugin extends Plugin {
	settings: AutoflowPluginSettings;
	openai: OpenAI;
	embeddingIndex: EmbeddingIndex = {};
	embeddingIndexPath: string;

	async onload() {
		await this.loadSettings();

		this.updateOpenAIClient();

		this.embeddingIndexPath = `${this.app.vault.configDir}/plugins/autoflow/embedding-index.json`;
		this.loadEmbeddingIndex();

		this.addCommand({
			id: 'run-flow',
			name: 'Run flow',
			callback: () => this.pickAndRunFlow()
		});

		this.addCommand({
			id: 'rebuild-ai-index',
			name: 'Rebuild AI Index',
			callback: () => this.pickAndRebuildIndex()
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AutoflowSettingTab(this.app, this));
	}

	onunload() {

	}

	updateOpenAIClient() {
		this.openai = new OpenAI({
			apiKey: this.settings.apiKey,
			dangerouslyAllowBrowser: true
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async loadEmbeddingIndex() {
		if (await this.app.vault.adapter.exists(this.embeddingIndexPath)) {
			const data = await this.app.vault.adapter.read(this.embeddingIndexPath);
			this.embeddingIndex = JSON.parse(data);
		}
	}

	async saveEmbeddingIndex() {
		const dir = this.embeddingIndexPath.substring(0, this.embeddingIndexPath.lastIndexOf('/'));
		if (!await this.app.vault.adapter.exists(dir)) {
			await this.app.vault.adapter.mkdir(dir);
		}
		await this.app.vault.adapter.write(this.embeddingIndexPath, JSON.stringify(this.embeddingIndex, null, 2));
	}

	async pickAndRunFlow() {
		const files = this.app.vault.getMarkdownFiles();
		const modal = new FlowPickerModal(this.app, files, async (file) => {
			const content = await this.app.vault.read(file);
			const flowDefinition = parseFlowDefinition(content);

			if (flowDefinition instanceof Error) {
				new Notice(`Invalid flow in ${file.name}: ${flowDefinition.message}. Ensure it starts with the 'autoflow' header.`);
				return;
			}

			if (this.settings.showFlowConfirmation) {
				new FlowSummaryModal(this.app, flowDefinition, this).open();
			} else {
				await this.runSteps(flowDefinition);
			}
		});
		modal.open();
	}

	async pickAndRebuildIndex() {
		const folders = this.app.vault.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder);

		new FolderPickerModal(this.app, folders, async (folder) => {
			new Notice(`Rebuilding index for ${folder.path}...`);
			const count = await this.rebuildIndexForFolder(folder.path);
			new Notice(`Rebuilding index for ${folder.path} complete. ${count} files indexed.`);
		}).open();
	}

	async rebuildIndexForFolder(folderPath: string): Promise<number> {
		const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folderPath));
		let count = 0;

		for (const file of files) {
			const content = await this.app.vault.cachedRead(file);
			const fileEmbedding = await this.getEmbedding(content);
			this.embeddingIndex[file.path] = {
				embedding: fileEmbedding,
				mtime: file.stat.mtime
			};
			count++;
		}

		await this.saveEmbeddingIndex();
		return count;
	}

	async logError(error: Error) {
		const logDir = `${this.app.vault.configDir}/plugins/autoflow/logs`;
		if (!await this.app.vault.adapter.exists(logDir)) {
			await this.app.vault.adapter.mkdir(logDir);
		}
		const logPath = `${logDir}/latest.log`;
		const timestamp = new Date().toISOString();
		const logMessage = `
---
Timestamp: ${timestamp}
Error: ${error.message}
Stack Trace:
${error.stack}
---`;
		await this.app.vault.adapter.append(logPath, logMessage);
	}

	async runSteps(definition: FlowDefinition) {
		const statusBar = this.addStatusBarItem();
		statusBar.setText('Autoflow: Running...');
		const context: Record<string, unknown> = {};

		try {
			for (const step of definition.steps) {
				switch (step.type) {
					case 'search':
						await this.executeSearchStep(step as SearchStep, context);
						break;
					case 'transform':
						await this.executeTransformStep(step as TransformStep, context);
						break;
					case 'write':
						await this.executeWriteStep(step as WriteStep, context);
						break;
				}
			}
			new Notice('Flow execution finished.');
		} catch (error) {
			new Notice('Flow execution failed. See logs for details.');
			console.error('Autoflow execution error:', error);
			if (error instanceof Error) {
				await this.logError(error);
			}
		} finally {
			statusBar.remove();
		}
	}

	async getEmbedding(text: string): Promise<number[]> {
		if (!this.settings.apiKey) {
			new Notice('OpenAI API key is not set.');
			throw new Error('API key not set');
		}

		try {
			const response = await this.openai.embeddings.create({
				model: this.settings.embeddingModel,
				input: text.replace(/\\n/g, ' '),
			});

			return response.data[0].embedding;
		} catch (error) {
			new Notice('Failed to generate embedding. See console for details.');
			console.error('Embedding generation error:', error);
			throw error;
		}
	}

	async executeSearchStep(step: SearchStep, context: Record<string, unknown>) {
		const files = this.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(step.sourceFolder));

		const query = step.query;
		if (!query) {
			// No query, return all files in source folder.
			const contents = await Promise.all(
				files.map(file => this.app.vault.cachedRead(file))
			);
			context.searchResults = contents;
			context.searchResultsFiles = files;
			return;
		}

		// With query, use embeddings
		const queryEmbedding = await this.getEmbedding(query);

		const fileEmbeddings: { file: TFile, similarity: number }[] = [];

		for (const file of files) {
			let fileEmbedding: number[];

			if (this.embeddingIndex[file.path] && this.embeddingIndex[file.path].mtime === file.stat.mtime) {
				fileEmbedding = this.embeddingIndex[file.path].embedding;
			} else {
				const content = await this.app.vault.cachedRead(file);
				fileEmbedding = await this.getEmbedding(content);
				this.embeddingIndex[file.path] = {
					embedding: fileEmbedding,
					mtime: file.stat.mtime
				};
			}

			const similarity = cosineSimilarity(queryEmbedding, fileEmbedding);
			fileEmbeddings.push({ file, similarity });
		}

		await this.saveEmbeddingIndex();

		fileEmbeddings.sort((a, b) => b.similarity - a.similarity);

		const topN = 10;
		const topFiles = fileEmbeddings.slice(0, topN).map(f => f.file);

		const contents = await Promise.all(
			topFiles.map(file => this.app.vault.cachedRead(file))
		);

		context.searchResults = contents;
		context.searchResultsFiles = topFiles;
	}

	async executeTransformStep(step: TransformStep, context: Record<string, unknown>) {
		const searchResults = context.searchResults as string[] || [];
		let content = searchResults.join('\\n\\n---\\n\\n');

		if (content.length > 8000) {
			content = content.substring(0, 8000);
		}

		const prompt = `${step.prompt}\\n\\n${content}`;

		if (!this.settings.apiKey) {
			new Notice('OpenAI API key not set.');
			return;
		}
		try {
			const response = await this.openai.chat.completions.create({
				model: this.settings.model,
				temperature: this.settings.temperature,
				messages: [
					{ role: 'user', content: prompt }
				]
			});

			context.transformResult = response.choices[0].message.content;
		} catch (error) {
			new Notice('OpenAI API Error. See console for details.');
			console.error('OpenAI API Error:', error);
			throw error;
		}
	}

	async executeWriteStep(step: WriteStep, context: Record<string, unknown>) {
		const contentToWrite = context.transformResult as string;
		if (!contentToWrite) {
			return;
		}

		const targetFile = step.targetFile.replace('{{date}}', new Date().toISOString().split('T')[0]);
		const directoryPath = targetFile.substring(0, targetFile.lastIndexOf('/'));

		if (directoryPath && !this.app.vault.getAbstractFileByPath(directoryPath)) {
			await this.app.vault.createFolder(directoryPath);
		}

		const existingFile = this.app.vault.getAbstractFileByPath(targetFile);
		if (existingFile) {
			await this.app.vault.adapter.append(targetFile, `\n\n${contentToWrite}`);
		} else {
			await this.app.vault.create(targetFile, contentToWrite);
		}
	}
}

class AutoflowSettingTab extends PluginSettingTab {
	plugin: AutoflowPlugin;

	constructor(app: App, plugin: AutoflowPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// API Key
		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Stored locally; never synced.')
			.addText(text => text
				.setPlaceholder('sk-...')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
					this.plugin.updateOpenAIClient();
				}));

		// Model
		new Setting(containerEl)
			.setName('Model')
			.setDesc('OpenAI model to use for text generation')
			.addText(text => text
				.setPlaceholder('gpt-4.1')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));

		// Embedding Model
		new Setting(containerEl)
			.setName('Embedding Model')
			.setDesc('OpenAI model to use for embeddings')
			.addText(text => text
				.setPlaceholder('text-embedding-3-small')
				.setValue(this.plugin.settings.embeddingModel)
				.onChange(async (value) => {
					this.plugin.settings.embeddingModel = value;
					await this.plugin.saveSettings();
				}));

		// Temperature
		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Sampling temperature (0-2)')
			.addSlider(slider =>
				slider
					.setLimits(0, 2, 0.1)
					.setValue(this.plugin.settings.temperature)
					.onChange(async (value) => {
						this.plugin.settings.temperature = value;
						await this.plugin.saveSettings();
					})
					.setDynamicTooltip()
			);

		// Confirmation Toggle
		new Setting(containerEl)
			.setName('Confirm before running flow')
			.setDesc('Show a summary dialog before executing a flow')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showFlowConfirmation)
				.onChange(async (value) => {
					this.plugin.settings.showFlowConfirmation = value;
					await this.plugin.saveSettings();
				}));
	}
}

class FolderPickerModal extends SuggestModal<TFolder> {
	constructor(app: App, private folders: TFolder[], private onChoose: (folder: TFolder) => void) {
		super(app);
	}

	getSuggestions(query: string): TFolder[] {
		return this.folders.filter(folder => folder.path.toLowerCase().includes(query.toLowerCase()));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement) {
		el.createEl('div', { text: folder.path });
	}

	onChooseSuggestion(folder: TFolder, evt: MouseEvent | KeyboardEvent) {
		this.onChoose(folder);
	}
}

class FlowPickerModal extends SuggestModal<TFile> {
	constructor(app: App, private files: TFile[], private onChoose: (file: TFile) => void) {
		super(app);
	}

	getSuggestions(query: string): TFile[] {
		return this.files.filter(file => file.name.toLowerCase().includes(query.toLowerCase()));
	}

	renderSuggestion(file: TFile, el: HTMLElement) {
		el.createEl('div', { text: file.name });
		el.createEl('small', { text: file.path, cls: 'autoflow-suggestion-path' });
	}

	onChooseSuggestion(file: TFile, evt: MouseEvent | KeyboardEvent) {
		this.onChoose(file);
	}
}

class FlowSummaryModal extends Modal {
	constructor(app: App, private flowDefinition: FlowDefinition, private plugin: AutoflowPlugin) {
		super(app);
	}

	onOpen() {
		const { contentEl, titleEl } = this;

		titleEl.setText(`Flow: ${this.flowDefinition.name}`);

		contentEl.createEl('p', { text: this.flowDefinition.description });

		contentEl.createEl('h3', { text: 'Steps' });
		const stepsEl = contentEl.createEl('ol');
		for (const step of this.flowDefinition.steps) {
			const stepLi = stepsEl.createEl('li');
			stepLi.createEl('strong', { text: `Type: ${step.type}` });
			const detailsUl = stepLi.createEl('ul');
			for (const [key, value] of Object.entries(step)) {
				if (key === 'type') continue;
				detailsUl.createEl('li', { text: `${key}: ${value}` });
			}
		}

		const buttonContainer = contentEl.createDiv({ cls: 'autoflow-modal-buttons' });
		const runButton = buttonContainer.createEl('button', { text: 'Run Flow', cls: 'mod-cta' });
		runButton.addEventListener('click', () => {
			this.plugin.runSteps(this.flowDefinition);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
