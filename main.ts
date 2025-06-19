import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, SuggestModal, TFile } from 'obsidian';
import * as yaml from 'js-yaml';

// Remember to rename these classes and interfaces!

export interface AutoflowPluginSettings {
	/** OpenAI or compatible API key */
	apiKey: string;
	/** Model name, e.g. gpt-3.5-turbo */
	model: string;
	/** Sampling temperature (0-2) */
	temperature: number;
}

export const DEFAULT_SETTINGS: AutoflowPluginSettings = {
	apiKey: '',
	model: 'gpt-4o',
	temperature: 0.7
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

export function parseFlowDefinition(text: string): FlowDefinition | Error {
    try {
        const data = yaml.load(text) as any;
        if (!data) {
            return new Error('Flow Definition is empty or invalid YAML.');
        }

        if (!data.name || typeof data.name !== 'string') {
            return new Error('Flow Definition missing required field "name" or it is not a string.');
        }

        if (!data.description || typeof data.description !== 'string') {
            return new Error('Flow Definition missing required field "description" or it is not a string.');
        }

        if (!data.steps || !Array.isArray(data.steps)) {
            return new Error('Flow Definition missing required field "steps" or it is not an array.');
        }

        for (const step of data.steps) {
            if (!step.type || typeof step.type !== 'string') {
                return new Error('A step is missing the "type" field.');
            }
            switch (step.type) {
                case 'search':
                    if (!step.sourceFolder || typeof step.sourceFolder !== 'string') {
                        return new Error('Search step is missing "sourceFolder".');
                    }
                    break;
                case 'transform':
                    if (!step.prompt || typeof step.prompt !== 'string') {
                        return new Error('Transform step is missing "prompt".');
                    }
                    break;
                case 'write':
                    if (!step.targetFile || typeof step.targetFile !== 'string') {
                        return new Error('Write step is missing "targetFile".');
                    }
                    break;
                default:
                    return new Error(`Unknown step type: ${step.type}`);
            }
        }

        return data as FlowDefinition;
    } catch (e) {
        return e instanceof Error ? e : new Error('Failed to parse YAML.');
    }
}

export default class AutoflowPlugin extends Plugin {
	settings: AutoflowPluginSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('This is a notice!');
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		this.addCommand({
			id: 'run-autoflow',
			name: 'Run Autoflow',
			callback: () => this.pickAndRunFlow()
		});

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new Notice("Hello from autoflow!");
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new Notice("Hello from autoflow (complex)!");
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AutoflowSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async pickAndRunFlow() {
		const files = this.app.vault.getMarkdownFiles();
		const modal = new FlowPickerModal(this.app, files, async (file) => {
			const content = await this.app.vault.read(file);
			const flowDefinition = parseFlowDefinition(content);

			if (flowDefinition instanceof Error) {
				new Notice(`Invalid flow definition in ${file.name}: ${flowDefinition.message}`);
				return;
			}

			new FlowSummaryModal(this.app, flowDefinition, this).open();
		});
		modal.open();
	}

	async runSteps(definition: FlowDefinition) {
		const statusBar = this.addStatusBarItem();
		statusBar.setText('Autoflow: Running...');
		const context: Record<string, any> = {};

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
			new Notice('Flow execution failed. See console for details.');
			console.error('Autoflow execution error:', error);
		} finally {
			statusBar.remove();
		}
	}

	async executeSearchStep(step: SearchStep, context: Record<string, any>) {
		const files = this.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(step.sourceFolder));

		let filteredFiles = files;
		const query = step.query;
		if (query) {
			filteredFiles = files.filter(f => f.name.toLowerCase().includes(query.toLowerCase()));
		}

		const contents = await Promise.all(
			filteredFiles.map(file => this.app.vault.cachedRead(file))
		);

		context.searchResults = contents;
		context.searchResultsFiles = filteredFiles;
	}

	async executeTransformStep(step: TransformStep, context: Record<string, any>) {
		const searchResults = context.searchResults as string[] || [];
		let content = searchResults.join('\\n\\n---\\n\\n');

		if (content.length > 8000) {
			content = content.substring(0, 8000);
		}

		const prompt = `${step.prompt}\\n\\n${content}`;

		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.settings.apiKey}`
			},
			body: JSON.stringify({
				model: this.settings.model,
				temperature: this.settings.temperature,
				messages: [
					{ role: 'user', content: prompt }
				]
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`OpenAI API Error: ${response.statusText} - ${errorText}`);
		}

		const data = await response.json();
		context.transformResult = data.choices[0].message.content;
	}

	async executeWriteStep(step: WriteStep, context: Record<string, any>) {
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
				}));

		// Model
		new Setting(containerEl)
			.setName('Model')
			.setDesc('OpenAI model to use')
			.addText(text => text
				.setPlaceholder('gpt-3.5-turbo')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
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
