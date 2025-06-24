# Autoflow for Obsidian

> An Obsidian plugin to automate your workflow by defining and running AI-powered tasks on your vault's files.

Autoflow allows you to chain together steps to search for notes, transform their content using AI, and write the results to a new file. It's designed to be a flexible tool for automating recurring knowledge work, such as summarizing meeting notes, generating reports, or synthesizing research.

## Features

*   **Custom AI Flows:** Define multi-step workflows within your Markdown notes.
*   **Semantic Search:** Uses AI embeddings to find notes based on conceptual meaning, not just keywords.
*   **AI-Powered Content Transformation:** Leverage large language models to summarize, analyze, or reformat your notes.
*   **External Prompts:** Reference a prompt from another Markdown file, keeping your flow definitions clean and reusable.
*   **Dynamic File Naming:** Automatically include the current date in output filenames.
*   **Manual Index Control:** A command to manually rebuild the AI search index for any folder.

## How it Works

The core of Autoflow is the **Flow Definition**, a plain-text section in any note that begins with the keyword `autoflow`. You then list the flow properties and steps line-by-line—no code blocks or indentation needed. When you run a flow, the plugin executes each step in order, passing the results from one step to the next.

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

## Settings Overview

The plugin's settings panel includes:

1. OpenAI API Key
2. Model & Embedding Model names
3. Temperature slider
4. **Confirm before running flow** – when on, Autoflow shows a summary dialog before a flow runs. (Off by default.)

## Creating a Flow

To create a flow, open or create a note and add a section like this (no code block required):

```text
autoflow
name: Generate Weekly Meeting Summary
description: "Searches for all meeting notes from this week and creates a summary of key decisions."
steps:
type: search
- sourceFolder: "Company/Meetings"
- query: "notes from this week"
type: transform
- prompt: "Review the following meeting notes and generate a concise summary of all key decisions and action items. Group items by project."
type: write
- targetFile: "Company/Reports/Weekly-Summary-{{date}}.md"
```

## Available Commands

Autoflow adds two commands to the Obsidian Command Palette:

*   **`Run Autoflow`**: Opens a modal where you can select and run any Markdown file that starts with an `autoflow` section.
*   **`Rebuild AI Index`**: Opens a modal to select a folder. It will then regenerate the semantic search index for all notes within that folder. This is useful if you've made bulk changes to your notes outside of Obsidian.

## Example Flow: Weekly Meeting Summary

Here is a complete example of a flow that finds all meeting notes from the past week, summarizes them, and saves the summary to a weekly report.

1.  **Create the Flow File:** Create a file named `Weekly Summary Flow.md` with the following content:

    # Weekly Meeting Summary Flow

    This flow finds all meeting notes from the current week, creates a summary, and saves it to a new report.

    ```text
    autoflow
    name: Generate Weekly Meeting Summary
    description: "Searches for all meeting notes from this week and creates a summary of key decisions."
    steps:
    type: search
    - sourceFolder: "Company/Meetings"
    - query: "notes from this week"
    type: transform
    - prompt: "Review the following meeting notes and generate a concise summary of all key decisions and action items. Group items by project."
    type: write
    - targetFile: "Company/Reports/Weekly-Summary-{{date}}.md"
    ```
2.  **Run the Flow:**
    *   Open the Command Palette (`Cmd+P`).
    *   Run the **`Run Autoflow`** command.
    *   Select `Weekly Summary Flow.md`.
    *   Click **"Run Flow"**.

After the flow completes, a new file named `Weekly-Summary-YYYY-MM-DD.md` will be created in your `Company/Reports` folder with the AI-generated summary.

## Example Flow: Using an External Prompt File

For complex prompts, you can store the prompt in a separate file and reference it from your flow. This keeps your flow definition tidy and makes it easy to reuse prompts across different flows.

1.  **Create the Prompt File:** Create a file named `Summarizer Prompt.md` in a `Prompts` folder with your detailed prompt instructions:

    ```markdown
    You are an expert analyst. Review the following documents and provide a one-page summary. Focus on identifying the core arguments, key evidence presented, and any unresolved questions. Structure your output with clear headings for each section.
    ```

2.  **Create the Flow File:** Create a file named `External Prompt Flow.md` that references the prompt file:

    ```text
    autoflow
    name: Generate Summary From File
    description: "Searches for notes and summarizes them using a prompt from another file."
    steps:
    type: search
    - sourceFolder: "Sources/Project-Alpha"
    type: transform
    - promptFile: "Prompts/Summarizer Prompt.md"
    type: write
    - targetFile: "Summaries/Project-Alpha-Summary-{{date}}.md"
    ```
3.  **Run the Flow:**
    *   Open the Command Palette (`Cmd+P`).
    *   Run the **`Run Autoflow`** command.
    *   Select `External Prompt Flow.md`.

The plugin will read `Prompts/Summarizer Prompt.md`, use its content as the prompt for the transform step, and write the output to the specified target file.

## Flow Commands & Parameters

Below is a reference of all commands (step types) you can use inside an **Autoflow** definition and the parameters each one accepts.

### Top-level keys

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `name` | string | yes | The display name of the flow in the UI. |
| `description` | string | yes | Short explanation of what the flow does. |
| `steps` | n/a | yes | One or more **step** definitions listed in the order you want them executed. |

### Step types

1. **search** – find notes to feed into later steps
   * `sourceFolder` (string, required) – folder path to search within (e.g. `"Projects/AI"`).
   * `query` (string, optional) – semantic-search query. If omitted, all markdown files in `sourceFolder` are returned.

2. **transform** – run an AI prompt on the collected content
   * `prompt` (string, conditional) – the text sent to the AI model. Required if `promptFile` is not used.
   * `promptFile` (string, conditional) – path to a Markdown file containing the prompt. Required if `prompt` is not used. The notes found in previous steps are appended automatically to the content of the file.

3. **write** – save the AI output
   * `targetFile` (string, required) – full path of the file to create/append (e.g. `"Reports/Summary-{{date}}.md"`). Supports `{{date}}` placeholder.

Example snippet showing each step type together:

```text
steps:

# search
type: search
- sourceFolder: "Research/2025"
- query: "LLM benchmarks"

# transform
type: transform
- prompt: "Summarise the key findings in bullet points."

# write
type: write
- targetFile: "Research/Summaries/LLM-Benchmark-{{date}}.md"
```
