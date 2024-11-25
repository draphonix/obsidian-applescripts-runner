import { App, Plugin, PluginSettingTab, Setting, TFile, MarkdownView, Modal } from 'obsidian';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface AppleScriptPluginSettings {
    defaultScript: string;
    enableDoneHeadingTrigger: boolean;
    targetFiles: string[];
    calendarName: string;
}

const DEFAULT_SETTINGS: AppleScriptPluginSettings = {
    defaultScript: '',
    enableDoneHeadingTrigger: true,
    targetFiles: [],
    calendarName: 'Logs'
}

export default class AppleScriptPlugin extends Plugin {
    settings: AppleScriptPluginSettings;
    app: App;
    lastDoneContent: Array<{title: string}> = [];

    /**
     * Initializes the plugin and sets up event handlers
     * 
     * @return: Promise that resolves when initialization is complete
     * @rtype: Promise<void>
     */
    async onload() {
        await this.loadSettings();
        
        // Register the command
        this.addCommand({
            id: 'run-applescript',
            name: 'Run AppleScript',
            callback: async () => {
                await this.runAppleScript(this.settings.defaultScript);
            }
        });

        // Register the file change event
        this.registerEvent(
            this.app.vault.on('modify', async (file: TFile) => {
                if (this.settings.enableDoneHeadingTrigger) {
                    await this.handleFileChange(file);
                }
            })
        );

        this.addSettingTab(new AppleScriptSettingTab(this.app, this));
    }

    /**
     * Handles file changes and processes tasks in the Done section
     * Triggers AppleScript execution for new tasks
     * 
     * @param file: The file that was modified
     * @type file: TFile
     * @return: Promise that resolves when file processing is complete
     * @rtype: Promise<void>
     */
    async handleFileChange(file: TFile) {
        if (!this.settings.targetFiles.includes(file.path)) {
            return;
        }

        try {
            const content = await this.app.vault.read(file);
            const doneData = this.extractDoneSection(content);
            
            if (doneData) {
                // Only trigger if we have more lines than before
                if (doneData.length > this.lastDoneContent.length) {
                    const latestDone = doneData[doneData.length - 1];
                    await this.runAppleScript(this.settings.defaultScript, {
                        title: latestDone.title,
                        content: latestDone.title
                    });
                }
                
                this.lastDoneContent = doneData;
            }
        } catch (error) {
            console.error('Error processing file change:', error);
        }
    }

    /**
     * Extracts tasks from the Done section of a Kanban board
     * Specifically looks for items in wiki-link format [[Task Name]]
     * 
     * @param content: The markdown content containing the Kanban board
     * @type content: string
     * @return: Array of task objects containing titles
     * @rtype: Array<{title: string}>
     */
    extractDoneSection(content: string): Array<{title: string}> {
        const lines = content.split('\n');
        let isDoneSection = false;
        let tasks: Array<{title: string}> = [];

        for (const line of lines) {
            if (line.trim() === '## Done') {
                isDoneSection = true;
                continue;
            }
            
            if (isDoneSection && line.startsWith('## ')) {
                break;
            }
            
            if (isDoneSection && line.includes('[[')) {
                const titleMatch = line.match(/\[\[(.*?)\]\]/);
                if (titleMatch) {
                    tasks.push({
                        title: titleMatch[1].trim()
                    });
                }
            }
        }

        return tasks;
    }

    /**
     * Executes an AppleScript with optional calendar event data
     * Formats the input data as an AppleScript record
     * 
     * @param script: The AppleScript code to execute
     * @type script: string
     * @param eventData: Optional calendar event data containing title and content
     * @type eventData: {title: string, content: string} | undefined
     * @return: Promise that resolves with the script output
     * @rtype: Promise<string>
     * @throws: Error if script execution fails
     */
    async runAppleScript(script: string, eventData?: { title: string, content: string }): Promise<string> {
        if (eventData) {
            const calendarData = `{calendarName:"${this.settings.calendarName}", summary:"${eventData.title}", description:"${eventData.content}"}`;
            script = `set input to ${calendarData}\n${script}`;
        }

        try {
            const { stdout } = await execAsync(`osascript -e '${script}'`);
            return stdout;
        } catch (error) {
            console.error('Error executing AppleScript:', error);
            throw error;
        }
    }

    /**
     * Loads plugin settings from storage
     * 
     * @return: Promise that resolves when settings are loaded
     * @rtype: Promise<void>
     */
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    /**
     * Saves plugin settings to storage
     * 
     * @return: Promise that resolves when settings are saved
     * @rtype: Promise<void>
     */
    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class AppleScriptSettingTab extends PluginSettingTab {
    plugin: AppleScriptPlugin;
    containerEl: HTMLElement;

    constructor(app: App, plugin: AppleScriptPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Default AppleScript')
            .setDesc('Enter the default AppleScript to run')
            .addTextArea(text => text
                .setPlaceholder('Enter your AppleScript here')
                .setValue(this.plugin.settings.defaultScript)
                .onChange(async (value) => {
                    this.plugin.settings.defaultScript = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Enable Done Heading Trigger')
            .setDesc('Trigger AppleScript when content under Done heading changes')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDoneHeadingTrigger)
                .onChange(async (value) => {
                    this.plugin.settings.enableDoneHeadingTrigger = value;
                    await this.plugin.saveSettings();
                }));

        // Add Target Files Section
        containerEl.createEl('h3', { text: 'Target Files' });

        // Display current target files
        this.plugin.settings.targetFiles.forEach((filePath: string, index: number) => {
            new Setting(containerEl)
                .setName(`Target File ${index + 1}`)
                .addText(text => text
                    .setValue(filePath)
                    .onChange(async (value) => {
                        this.plugin.settings.targetFiles[index] = value;
                        await this.plugin.saveSettings();
                    }))
                .addButton(button => button
                    .setButtonText('Remove')
                    .onClick(async () => {
                        this.plugin.settings.targetFiles.splice(index, 1);
                        await this.plugin.saveSettings();
                        this.display(); // Refresh the display
                    }));
        });

        // Add button to add new target file
        new Setting(containerEl)
            .setName('Add Target File')
            .setDesc('Add a new file to monitor for Done heading changes')
            .addButton(button => button
                .setButtonText('Add File')
                .onClick(async () => {
                    // Show file selector modal
                    const fileSelector = new FileSelectorModal(this.app, async (selectedFile) => {
                        if (selectedFile) {
                            this.plugin.settings.targetFiles.push(selectedFile.path);
                            await this.plugin.saveSettings();
                            this.display(); // Refresh the display
                        }
                    });
                    fileSelector.open();
                }));

        new Setting(containerEl)
            .setName('Calendar Name')
            .setDesc('Enter the name of the calendar to add events to')
            .addText(text => text
                .setPlaceholder('Calendar Name')
                .setValue(this.plugin.settings.calendarName)
                .onChange(async (value) => {
                    this.plugin.settings.calendarName = value;
                    await this.plugin.saveSettings();
                }));
    }
}

/**
 * Modal for selecting files from the vault
 */
class FileSelectorModal extends Modal {
    private app: App;

    constructor(
        app: App,
        private onChoose: (file: TFile | null) => void
    ) {
        super(app);
        this.app = app;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Select a file to monitor' });

        const fileList = contentEl.createEl('div');
        fileList.style.maxHeight = '400px';
        fileList.style.overflow = 'auto';

        // Get all markdown files from the vault
        const markdownFiles = this.app.vault.getMarkdownFiles();
        
        markdownFiles.forEach((file: TFile) => {
            const fileItem = fileList.createEl('div', { 
                text: file.path,
                cls: 'file-item'
            });
            
            fileItem.style.padding = '5px';
            fileItem.style.cursor = 'pointer';
            fileItem.style.borderBottom = '1px solid var(--background-modifier-border)';

            fileItem.addEventListener('click', () => {
                this.onChoose(file);
                this.close();
            });

            fileItem.addEventListener('mouseover', () => {
                fileItem.style.backgroundColor = 'var(--background-modifier-hover)';
            });

            fileItem.addEventListener('mouseout', () => {
                fileItem.style.backgroundColor = '';
            });
        });
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
} 