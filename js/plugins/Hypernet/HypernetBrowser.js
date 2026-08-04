/*:
 * @target MZ
 * @plugindesc v2.0.0 Refactored alchemical Hypernet Explorer Browser App for HypernetOS.
 * @author Omni-Lex
 * 
 * @help
 * HypernetBrowser.js
 * 
 * Simulated browser app that registers natively within the HypernetOS environment.
 * Exposes:
 * - window.HypernetBrowserApp.launch()
 */

(() => {
    'use strict';

    window.HypernetBrowserApp = {
        launch: function() {
            if (!window.HypernetOS || !window.HypernetOS.WindowManager) {
                console.error("HypernetOS Window Manager is not loaded!");
                return;
            }

            const contentHTML = `
                <div  class="hn-style-0045">
                    <iframe class="hypernet-iframe hn-style-0046" src="hypernet-explorer.html" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" ></iframe>
                    <!-- Premium Glassmorphic  Status Footer -->
                    <div class="hypernet-alchemical-footer hn-style-0047" >
                        <div class="hypernet-footer-status hn-style-0048" >
                            <div class="hypernet-footer-led hn-style-0049" ></div>
                            ${T('HypernetBrowser.linkStable')}
                        </div>
                        <div  class="hn-style-0050">${T('HypernetBrowser.secureSsl')}</div>
                    </div>
                </div>
            `;

            const win = window.HypernetOS.WindowManager.createWindow({
                id: 'app-hypernet-browser',
                title: T('HypernetBrowser.windowTitle'),
                icon: 188, // Globe icon from IconSet.png
                width: 960,
                height: 640,
                contentHTML: contentHTML
            });

            // Focus iframe so immediate shortcuts work inside, and handle load failures
            setTimeout(() => {
                const iframe = win.querySelector('.hypernet-iframe');
                if (!iframe) return;
                iframe.onerror = () => {
                    iframe.style.display = 'none';
                    const fallback = document.createElement('div');
                    fallback.className = 'hypernet-iframe-error';
                    fallback.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center;color:#5d4037;font-size:14px;';
                    fallback.textContent = T('HypernetBrowser.linkLost');
                    if (iframe.parentNode) iframe.parentNode.insertBefore(fallback, iframe);
                };
                iframe.focus();
            }, 300);
        }
    };

    // Register inside HypernetOS core app registry
    if (window.HypernetOS) {
        window.HypernetOS.registerApp({
            id: 'app-hypernet-browser',
            name: T('HypernetBrowser.appName'),
            icon: 188,
            launchFn: function() {
                window.HypernetBrowserApp.launch();
            },
            desktopShortcut: true,
            // The browser is the machine's headline app: it gets the reserved
            // right-hand column of the desktop, on its own.
            desktopAnchor: 'right'
        });
    }

    // Backwards compatibility plugin command mapping:
    const pluginName = "HypernetBrowser";
    PluginManager.registerCommand(pluginName, "OpenBrowser", args => {
        SceneManager.push(Scene_HypernetOS);
        SceneManager.prepareNextScene({ autoLaunch: 'app-hypernet-browser' });
    });

})();
