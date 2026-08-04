/*:
 * @target MZ
 * @plugindesc v1.0.0 Control Panel settings app for HypernetOS.
 * @author Omni-Lex
 * 
 * @help
 * HypernetControlPanel.js
 * 
 * Launches Control Panel:
 * window.HypernetOS.launchApp('control-panel')
 */

(() => {
    'use strict';

    window.HypernetControlPanel = {
        launch: function() {
            if (!window.HypernetOS || !window.HypernetOS.WindowManager) {
                console.error("HypernetOS core not loaded!");
                return;
            }

            const id = 'app-hypernet-control-panel';
            
            // Collect RPG Maker stat conversions for System Properties
            const leader = $gameParty.leader();
            const leaderName = leader ? leader.name() : T('ControlPanel.defaultUser');
            const leaderLvl = leader ? leader.level : 1;
            
            const cpuName = T('ControlPanel.cpuName', { user: leaderName, level: leaderLvl });
            const ramSize = leader ? T('ControlPanel.ramSize', { mb: leader.mmp })
                : T('ControlPanel.ramDefault');
            const gpuName = leader ? T('ControlPanel.gpuName', { mhz: leader.agi })
                : T('ControlPanel.gpuDefault');
            const psuName = leader ? T('ControlPanel.psuName', { watts: leader.mhp })
                : T('ControlPanel.psuDefault');
            
            const totalGold = typeof $gameParty !== 'undefined' ? $gameParty.gold() : 0;
            const hddSize = T('ControlPanel.hddSize', { gb: Math.max(10, Math.floor(totalGold / 10)) });

            // Class stats
            const strStat = leader ? leader.atk : 10;
            const defStat = leader ? leader.def : 10;
            const intStat = leader ? leader.mat : 10;
            const wisStat = leader ? leader.mdf : 10;
            const lukStat = leader ? leader.luk : 10;

            const contentHTML = `
                <div class="control-panel-container hn-style-0051" >
                    <!-- Tab Headers -->
                    <div class="cp-tabs hn-style-0052" >
                        <div class="cp-tab active focusable hn-style-0053" id="tab-btn-general" tabindex="0" >${T('ControlPanel.tabSpecs')}</div>

                        <div class="cp-tab focusable hn-style-0054" id="tab-btn-display" tabindex="0" >${T('ControlPanel.tabWallpaper')}</div>
                    </div>

                    <!-- Tab Contents -->
                    <div class="cp-content-box hn-style-0055" >
                        
                        <!-- GENERAL TAB -->
                        <div class="cp-tab-pane hn-style-0056" id="pane-general" >
                            <div  class="hn-style-0057">
                                <div  class="hn-style-0058">${window.HypernetOS.getIconHTML(234, 48)}</div>
                                <div>
                                    <h3  class="hn-style-0059">${T('ControlPanel.systemProperties')}</h3>
                                    <div>${T('ControlPanel.environment')}</div>
                                    <div>${T('ControlPanel.version')}</div>
                                </div>
                            </div>

                            <div  class="hn-style-0060">
                                <!-- Column 1: System Specs -->
                                <div  class="hn-style-0061">
                                    <h4  class="hn-style-0062">${T('ControlPanel.hardwareSpecs')}</h4>
                                    <table  class="hn-style-0063">
                                        <tr>
                                            <td  class="hn-style-0064">${T('ControlPanel.processor')}</td>
                                            <td  class="hn-style-0065">${cpuName}</td>
                                        </tr>
                                        <tr>
                                            <td  class="hn-style-0066">${T('ControlPanel.memory')}</td>
                                            <td  class="hn-style-0065">${ramSize}</td>
                                        </tr>
                                        <tr>
                                            <td  class="hn-style-0066">${T('ControlPanel.graphics')}</td>
                                            <td  class="hn-style-0065">${gpuName}</td>
                                        </tr>
                                        <tr>
                                            <td  class="hn-style-0066">${T('ControlPanel.hardDrive')}</td>
                                            <td  class="hn-style-0065">${hddSize}</td>
                                        </tr>
                                        <tr>
                                            <td  class="hn-style-0066">${T('ControlPanel.powerGrid')}</td>
                                            <td  class="hn-style-0065">${psuName}</td>
                                        </tr>
                                    </table>
                                </div>

                                <!-- Column 2:  Cores -->
                                <div  class="hn-style-0061">
                                    <h4  class="hn-style-0062">${T('ControlPanel.coresIntegrity')}</h4>
                                    <table  class="hn-style-0063">
                                        <tr>
                                            <td  class="hn-style-0067">${T('ControlPanel.strCore')}</td>
                                            <td  class="hn-style-0068">${strStat} (${defStat})</td>
                                        </tr>
                                        <tr>
                                            <td  class="hn-style-0066">${T('ControlPanel.intCore')}</td>
                                            <td  class="hn-style-0068">${intStat} (${wisStat})</td>
                                        </tr>
                                        <tr>
                                            <td  class="hn-style-0066">${T('ControlPanel.psiCore')}</td>
                                            <td  class="hn-style-0068">${lukStat}</td>
                                        </tr>
                                        <tr>
                                            <td  class="hn-style-0066">${T('ControlPanel.factionsRep')}</td>
                                            <td  class="hn-style-0065">${T('ControlPanel.tendencyVar')}</td>
                                        </tr>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <!-- DISPLAY TAB -->
                        <div class="cp-tab-pane hn-style-0069" id="pane-display" >
                            <div>
                                <h3  class="hn-style-0070">${T('ControlPanel.selectBackground')}</h3>
                                <p  class="hn-style-0071">${T('ControlPanel.wallpaperHint')}</p>
                            </div>
                            
                            <div  class="hn-style-0072">
                                <!-- Bliss Wallpaper -->
                                <div class="wp-card focusable hn-style-0073" id="wp-bliss" tabindex="0" >
                                    <div  class="hn-style-0074"></div>
                                    <span  class="hn-style-0075">${T('ControlPanel.wpBliss')}</span>
                                </div>

                                <!-- Classic Teal Wallpaper -->
                                <div class="wp-card focusable hn-style-0076" id="wp-teal" tabindex="0" >
                                    <div  class="hn-style-0077"></div>
                                    <span  class="hn-style-0075">${T('ControlPanel.wpTeal')}</span>
                                </div>

                                <!-- Cosmic Space Wallpaper -->
                                <div class="wp-card focusable hn-style-0076" id="wp-space" tabindex="0" >
                                    <div  class="hn-style-0078"></div>
                                    <span  class="hn-style-0075">${T('ControlPanel.wpSpace')}</span>
                                </div>

                                <!--  Gold Wallpaper -->
                                <div class="wp-card focusable hn-style-0076" id="wp-gold" tabindex="0" >
                                    <div  class="hn-style-0079"></div>
                                    <span  class="hn-style-0075">${T('ControlPanel.wpGold')}</span>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            `;

            const win = window.HypernetOS.WindowManager.createWindow({
                id: id,
                title: T('ControlPanel.title'),
                icon: 234, // gear settings icon
                width: 640,
                height: 480,
                contentHTML: contentHTML
            });

            // Tab Buttons
            const tabGenBtn = win.querySelector('#tab-btn-general');
            const tabDispBtn = win.querySelector('#tab-btn-display');
            
            // Tab Panes
            const paneGen = win.querySelector('#pane-general');
            const paneDisp = win.querySelector('#pane-display');

            tabGenBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                tabGenBtn.className = 'cp-tab active focusable';
                tabGenBtn.style.background = '#ece9d8';
                tabGenBtn.style.borderColor = '#0054e3';
                tabGenBtn.style.fontWeight = 'bold';

                tabDispBtn.className = 'cp-tab focusable';
                tabDispBtn.style.background = '#c5dcf7';
                tabDispBtn.style.borderColor = '#adcbf3';
                tabDispBtn.style.fontWeight = 'normal';

                paneGen.style.display = 'flex';
                paneDisp.style.display = 'none';
            });

            tabDispBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                tabDispBtn.className = 'cp-tab active focusable';
                tabDispBtn.style.background = '#ece9d8';
                tabDispBtn.style.borderColor = '#0054e3';
                tabDispBtn.style.fontWeight = 'bold';

                tabGenBtn.className = 'cp-tab focusable';
                tabGenBtn.style.background = '#c5dcf7';
                tabGenBtn.style.borderColor = '#adcbf3';
                tabGenBtn.style.fontWeight = 'normal';

                paneDisp.style.display = 'flex';
                paneGen.style.display = 'none';
                
                // Highlight current active wallpaper card
                if (window.HypernetFileSystem) {
                    const currentWp = window.HypernetFileSystem.getRegistry('wallpaper', 'bliss');
                    win.querySelectorAll('.wp-card').forEach(card => {
                        card.style.borderColor = card.id === `wp-${currentWp}` ? '#0054e3' : '#ccc';
                    });
                }
            });

            // Wallpaper Card Click Handlers
            const wallpaperCards = win.querySelectorAll('.wp-card');
            wallpaperCards.forEach(card => {
                card.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const wallpaperName = card.id.replace('wp-', '');
                    
                    if (window.HypernetFileSystem) {
                        window.HypernetFileSystem.setRegistry('wallpaper', wallpaperName);
                    }
                    
                    // Highlight selected card
                    wallpaperCards.forEach(c => {
                        c.style.borderColor = c.id === card.id ? '#0054e3' : '#ccc';
                    });

                    if (window.SoundManager) SoundManager.playOk();
                });
            });
        }
    };

    // Register inside HypernetOS App registry
    if (window.HypernetOS) {
        window.HypernetOS.registerApp({
            id: 'control-panel',
            name: T('ControlPanel.title'),
            icon: 234,
            launchFn: function() {
                window.HypernetControlPanel.launch();
            },
            desktopShortcut: true
        });
    }

})();
