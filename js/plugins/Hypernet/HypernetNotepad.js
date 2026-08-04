/*:
 * @target MZ
 * @plugindesc v1.0.0 Simulated Notepad text editor application for HypernetOS.
 * @author Omni-Lex
 * 
 * @help
 * HypernetNotepad.js
 * 
 * Launches Notepad editor:
 * window.HypernetOS.launchApp('app-hypernet-notepad')
 * 
 * Launches Notepad and loads a specific file:
 * window.HypernetNotepad.openFile('C:/Documents/welcome.txt')
 */

(() => {
    'use strict';

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    window.HypernetNotepad = {
        openFile: function(path) {
            const content = window.HypernetFileSystem ? window.HypernetFileSystem.readFile(path) : '';
            this.launch(path, content);
        },

        launch: function(path = '', content = '') {
            if (!window.HypernetOS || !window.HypernetOS.WindowManager) {
                console.error("HypernetOS core not loaded!");
                return;
            }

            if (content == null) content = '';

            const id = 'app-hypernet-notepad';
            const fileName = path ? path.substring(path.lastIndexOf('/') + 1)
                : T('HypernetNotepad.untitled');
            const title = T('HypernetNotepad.windowTitle', { file: fileName });
            
            const contentHTML = `
                <div class="notepad-container hn-style-0098" >
                    <!-- Menu Bar -->
                    <div class="notepad-menu-bar hn-style-0099" >
                        <div class="notepad-menu-item focusable hn-style-0100"  id="notepad-menu-file" tabindex="0">
                            <u>F</u>${T('HypernetNotepad.menuFileTail')}
                            <div class="notepad-dropdown hn-style-0101" id="notepad-file-dropdown" >
                                <div class="notepad-dropdown-action focusable hn-style-0102" id="action-save" tabindex="0" >${T('HypernetNotepad.save')}</div>
                                <div class="notepad-dropdown-action focusable hn-style-0103" id="action-exit" tabindex="0" >${T('HypernetNotepad.exit')}</div>
                            </div>
                        </div>
                        <div class="notepad-menu-item hn-style-0104" >${T('HypernetNotepad.menuEdit')}</div>
                        <div class="notepad-menu-item hn-style-0104" >${T('HypernetNotepad.menuFormat')}</div>
                        <div class="notepad-menu-item hn-style-0104" >${T('HypernetNotepad.menuHelp')}</div>
                    </div>
                    
                    <!-- TextArea Editor -->
                    <textarea class="notepad-textarea hn-style-0105" id="notepad-text-content"  spellcheck="false"></textarea>
                    
                    <!-- Footer Status Bar -->
                    <div class="notepad-status-bar hn-style-0106" >
                        Ln 1, Col ${content.length + 1}
                    </div>
                </div>

                
            `;

            const win = window.HypernetOS.WindowManager.createWindow({
                id: id,
                title: title,
                icon: 190, // Scroll/Text document icon
                width: 620,
                height: 460,
                contentHTML: contentHTML
            });

            // Handle Menu Dropdowns
            const fileMenu = win.querySelector('#notepad-menu-file');
            const fileDropdown = win.querySelector('#notepad-file-dropdown');
            const saveBtn = win.querySelector('#action-save');
            const exitBtn = win.querySelector('#action-exit');
            const textarea = win.querySelector('#notepad-text-content');
            // Set content via value (not innerHTML) so a file containing </textarea> or
            // other markup cannot break out of the element.
            if (textarea) textarea.value = content;

            fileMenu.addEventListener('click', (e) => {
                e.stopPropagation();
                const show = fileDropdown.style.display === 'flex';
                fileDropdown.style.display = show ? 'none' : 'flex';
            });

            // Close dropdown when clicking outside
            const closeDropdown = () => {
                fileDropdown.style.display = 'none';
            };
            document.addEventListener('click', closeDropdown);
            win.addEventListener('hypernet-closed', () => {
                document.removeEventListener('click', closeDropdown);
            });

            // Save Function
            saveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                fileDropdown.style.display = 'none';
                
                let targetPath = path;
                if (!targetPath) {
                    const typedName = prompt(T('HypernetNotepad.savePrompt'), "note.txt");
                    if (typedName) {
                        const finalName = typedName.toLowerCase().endsWith('.txt') ? typedName : typedName + '.txt';
                        targetPath = `C:/Documents/${finalName}`;
                    } else {
                        return; // Cancelled
                    }
                }

                if (window.HypernetFileSystem && window.HypernetFileSystem.writeFile(targetPath, textarea.value)) {
                    path = targetPath;
                    const finalFileName = path.substring(path.lastIndexOf('/') + 1);
                    win.dataset.title = T('HypernetNotepad.windowTitle', { file: finalFileName });
                    
                    const titleText = win.querySelector('.hypernet-window-title');
                    if (titleText) {
                        titleText.innerHTML = win.dataset.iconHTML + ' '
                            + T('HypernetNotepad.windowTitle', { file: escapeHtml(finalFileName) });
                    }
                    if (window.SoundManager) SoundManager.playOk();
                } else {
                    alert(T('HypernetNotepad.writeError'));
                }
            });

            // Exit Function
            exitBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.HypernetOS.WindowManager.closeWindow(win);
            });

            // Auto-focus textarea
            setTimeout(() => {
                textarea.focus();
                // Move cursor to end of text
                textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
            }, 250);
        }
    };

    // Register Notepad application inside HypernetOS App registry
    if (window.HypernetOS) {
        window.HypernetOS.registerApp({
            id: 'app-hypernet-notepad',
            name: T('HypernetNotepad.appName'),
            icon: 190,
            launchFn: function() {
                window.HypernetNotepad.launch();
            },
            desktopShortcut: true
        });
    }

})();
