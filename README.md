# Autoflow for Obsidian

> An Obsidian plugin to automate your workflow by defining and running AI-powered tasks on your vault's files.

Autoflow allows you to chain together steps to search for notes, transform their content using AI, and write the results to a new file. It's designed to be a flexible tool for automating recurring knowledge work, such as summarizing meeting notes, generating reports, or synthesizing research.

## Features

*   **Custom AI Flows:** Define multi-step workflows using a simple YAML format.
*   **Semantic Search:** Uses AI embeddings to find notes based on conceptual meaning, not just keywords.
*   **AI-Powered Content Transformation:** Leverage large language models to summarize, analyze, or reformat your notes.
*   **Dynamic File Naming:** Automatically include the current date in output filenames.
*   **Manual Index Control:** A command to manually rebuild the AI search index for any folder.

## How it Works

The core of Autoflow is the **Flow Definition**, a YAML file where you specify a series of steps. When you run a flow, the plugin executes each step in order, passing the results from one step to the next.

For example, a typical flow might:
1.  **Search** for all notes in your "Meeting Notes" folder that are conceptually related to "Project Phoenix."
2.  **Transform** the content of those notes by passing them to an AI with a prompt like "Summarize the key decisions and action items from the following notes."
3.  **Write** the AI's summary to a new file in your "Reports" folder.


## Configuration

Before you can use Autoflow, you must configure your OpenAI API key.

1.  In your Obsidian vault, navigate to `Settings` > `Community plugins`.
2.  Find "Autoflow" in the list and click the "Options" tab.
3.  Enter your OpenAI API key into the text field. The key is stored locally on your device and is never synced.
4.  (Optional) You can also change the default text generation model and the embedding model. For most use cases, the defaults (`gpt-4.1` and `text-embedding-3-small`) are recommended.

## Creating a Flow

To create a flow, simply create a new file anywhere in your vault with a YAML block that defines the flow.

### Flow Properties

A flow definition has three top-level properties:

*   `name` (required): The name of your flow. This is used to identify the flow in the UI.
*   `description` (required): A brief explanation of what the flow does.
*   `steps` (required): A list of one or more step objects that define the workflow.

### Step Types

There are three types of steps you can use in a flow.

#### 1. `search`

The `search` step finds a set of notes and adds their content to the context for the next step.

**Parameters:**

*   `type`: Must be `search`.
*   `sourceFolder` (required): The path to the folder you want to search within.
*   `query` (optional): A string to search for. If provided, Autoflow will perform a **semantic search** to find notes that are conceptually related to the query. If omitted, the step will return all files in the `sourceFolder`.

**Example:**
```yaml
- type: search
  sourceFolder: "Knowledge Base/Projects"
  query: "research about market trends in AI"
```

#### 2. `transform`

The `transform` step takes the content from the previous step (e.g., search results) and uses an AI model to transform it.

**Parameters:**

*   `type`: Must be `transform`.
*   `prompt` (required): The instructions you want to give the AI model. The content from the previous step will be automatically appended to this prompt.

**Example:**
```yaml
- type: transform
  prompt: "Synthesize the following research notes into a single, coherent summary. Identify the top 3 most important findings."
```

#### 3. `write`

The `write` step takes the result from a `transform` step and writes it to a file.

**Parameters:**

*   `type`: Must be `write`.
*   `targetFile` (required): The full path, including the filename, where the output should be saved. If the file already exists, the output will be appended to it.
    *   **Dynamic Dates:** You can use the `{{date}}` placeholder in the filename to automatically insert the current date in `YYYY-MM-DD` format.

**Example:**
```yaml
- type: write
  targetFile: "Reports/Weekly Summaries/AI-Trends-{{date}}.md"
```

## Available Commands

Autoflow adds two commands to the Obsidian Command Palette:

*   **`Run Autoflow`**: Opens a modal where you can select and run any flow definition file from your vault.
*   **`Rebuild AI Index`**: Opens a modal to select a folder. It will then regenerate the semantic search index for all notes within that folder. This is useful if you've made bulk changes to your notes outside of Obsidian.

## Example Flow: Weekly Meeting Summary

Here is a complete example of a flow that finds all meeting notes from the past week, summarizes them, and saves the summary to a weekly report.

1.  **Create the Flow File:** Create a file named `Weekly Summary Flow.md` with the following content:
    ```yaml
    name: Generate Weekly Meeting Summary
    description: "Searches for all meeting notes from this week and creates a summary of key decisions."
    steps:
      - type: search
        sourceFolder: "Company/Meetings"
        query: "notes from this week"
      - type: transform
        prompt: "Review the following meeting notes and generate a concise summary of all key decisions and action items. Group items by project."
      - type: write
        targetFile: "Company/Reports/Weekly-Summary-{{date}}.md"
    ```
2.  **Run the Flow:**
    *   Open the Command Palette (`Cmd+P`).
    *   Run the **`Run Autoflow`** command.
    *   Select `Weekly Summary Flow.md`.
    *   Click **"Run Flow"**.

After the flow completes, a new file named `Weekly-Summary-YYYY-MM-DD.md` will be created in your `Company/Reports` folder with the AI-generated summary.
