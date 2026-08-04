/*:
 * @target MZ
 * @plugindesc Title screen game updater. Downloads the public plugin repository and replaces the game files in the root folder.
 * @author Omni-Lex
 *
 * @param owner
 * @text Repository owner
 * @desc GitHub account that hosts the update repository.
 * @default nocoldiz
 *
 * @param repo
 * @text Repository name
 * @desc Name of the update repository. Its root mirrors the game root folder.
 * @default hypernet-explorer-plugins
 *
 * @param branch
 * @text Branch
 * @desc The only branch the updater reads. Its history is the build list.
 * @default main
 *
 * @param historySize
 * @text Builds per page
 * @type number
 * @min 5
 * @max 100
 * @desc How many past builds are listed at a time.
 * @default 20
 *
 * @param concurrency
 * @text Parallel downloads
 * @type number
 * @min 1
 * @max 16
 * @desc How many files are downloaded at the same time.
 * @default 5
 *
 * @param baseCommit
 * @text Build number origin
 * @desc Where the history starts. Builds are numbered by how many commits came after it, and nothing before it is listed.
 * @default f82efcc816a0e07049b3466b1013eaae7105ecf0
 *
 * @help TitleScreenGameUpdater.js
 * ============================================================================
 * Adds an UPDATES entry to the title screen that pulls the game files from a
 * public GitHub repository. The repository root mirrors the game root folder,
 * so js/plugins/Foo.js in the repository replaces js/plugins/Foo.js here.
 *
 * Downloading is enabled (DOWNLOADS_ENABLED = true): the screen checks the
 * branch, reports the latest build and what changed in it, and installs it on
 * request. Setting the flag to false turns it back into a read-only report
 * that fetches nothing and touches no local file.
 *
 * Only one branch is read (main). Its commit history is the build list: the
 * newest build sits at the top and every past build under it, so a player can
 * install the latest one or go back to any earlier build. Older builds are
 * fetched a page at a time, and the list stops at the numbering origin (the
 * baseCommit parameter): that build is the oldest one offered and nothing
 * before it is listed.
 *
 * How an update runs
 *   1. The branch history is read from the GitHub API and the player picks a
 *      build. The newest one is picked and checked on opening the screen.
 *   2. Every file in that build is compared with the local one by git blob
 *      hash, so only files that really differ are downloaded, and only those
 *      count toward the download size. A text file whose only difference is
 *      CRLF line endings holds the same content as the LF blob the repository
 *      stores, so it is left alone as well. Going back to an older build works
 *      the same way, it just replaces newer files with the older ones.
 *   3. All of them are fetched into save/updater/tmp and verified against the
 *      hash the repository declared.
 *   4. Only once every file is downloaded and verified are they moved into
 *      place. The replaced files are copied to save/updater/backup/<time>
 *      first, and the three most recent backups are kept.
 *   5. The game must be restarted for the new files to load. The updater
 *      offers to do it.
 *
 * Nothing is ever deleted: files that exist here but not in the repository are
 * left alone, and so is everything under save/. Going back to an older build
 * therefore leaves behind any file that build never had.
 *
 * The build number
 *   Whichever build is installed is also a number: how many commits on the
 *   branch came after the origin commit (the baseCommit parameter). It is read
 *   once per build from the compare API, kept in save/updater/state.json and
 *   handed to the title screen, which writes it into the third field of the
 *   version badge (0.0.<build>a). A copy that has never updated has no build
 *   number and keeps the version string as written.
 *
 * Checking on launch
 *   The title screen calls GameUpdater.autoCheck() once per session. It reads
 *   the branch, and only compares local files when the newest build is not the
 *   one already recorded as installed, so an up-to-date copy costs one request.
 *   Everything it finds is reported through GameUpdater.autoResult(); nothing is
 *   downloaded and no local file is touched.
 *
 * Requires the desktop (NW.js) build. On the web build the command is hidden
 * because there is no local file system to write to.
 *
 * Controls
 *   Up / Down / W / S  , move between builds or actions
 *   Right / D          , enter the action list
 *   Left / A           , back to the build list
 *   OK / Enter         , check the highlighted build or run the action
 *   Cancel / Esc       , back to the title (aborts a running download)
 * ============================================================================
 */

(function () {
    'use strict';

    const PLUGIN_NAME = 'TitleScreenGameUpdater';
    const params = PluginManager.parameters(PLUGIN_NAME);

    const OWNER        = String(params.owner || 'nocoldiz');
    const REPO         = String(params.repo || 'hypernet-explorer-plugins');
    const BRANCH       = String(params.branch || 'main');
    const PAGE_SIZE    = Math.max(5, Math.min(100, Number(params.historySize) || 20));
    const CONCURRENCY  = Math.max(1, Math.min(16, Number(params.concurrency) || 5));
    // Build numbering counts the commits that came after this one.
    const BASE_COMMIT  = String(params.baseCommit || 'f82efcc816a0e07049b3466b1013eaae7105ecf0');

    const USER_AGENT  = 'HypernetExplorer-Updater';
    const TIMEOUT_MS  = 30000;
    const KEEP_BACKUPS = 3;
    // How many resolved build numbers the state file keeps, oldest dropped first.
    const KEEP_BUILD_NUMBERS = 60;

    // Downloading and installing. Set this to false to leave the screen as a
    // read-only report of what the branch holds, touching no local file.
    const DOWNLOADS_ENABLED = true;

    // Paths the updater refuses to touch even if the repository ships them.
    const EXCLUDED = ['.gitignore', '.github/', 'save/'];

    // =========================================================================
    // Localisation
    // =========================================================================


    // The updater's copy lives in js/i18n/<lang>/plugins/GameUpdater.json.
    function getT() {
        return T.obj('GameUpdater');
    }
    function fmt(str) {
        const args = Array.prototype.slice.call(arguments, 1);
        return String(str).replace(/%(\d+)/g, (m, i) => {
            const v = args[Number(i) - 1];
            return v === undefined ? m : String(v);
        });
    }
    function esc(text) {
        return String(text === undefined || text === null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    function shortSha(sha) {
        return sha ? String(sha).slice(0, 7) : null;
    }
    function formatBytes(bytes) {
        const b = Number(bytes) || 0;
        if (b < 1024) return b + ' B';
        if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
        return (b / (1024 * 1024)).toFixed(1) + ' MB';
    }
    function formatDate(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // =========================================================================
    // Environment
    // =========================================================================
    const hasNode = (function () {
        try {
            return typeof Utils !== 'undefined' && Utils.isNwjs() && typeof require === 'function';
        } catch (e) {
            return false;
        }
    })();

    let fs = null, nodePath = null, https = null, crypto = null;
    let BASE_DIR = '', WORK_DIR = '', TMP_DIR = '', BACKUP_DIR = '', STATE_FILE = '', HASH_FILE = '';

    if (hasNode) {
        try {
            fs       = require('fs');
            nodePath = require('path');
            https    = require('https');
            crypto   = require('crypto');
            BASE_DIR = resolveBaseDir();
            WORK_DIR   = nodePath.join(BASE_DIR, 'save', 'updater');
            TMP_DIR    = nodePath.join(WORK_DIR, 'tmp');
            BACKUP_DIR = nodePath.join(WORK_DIR, 'backup');
            STATE_FILE = nodePath.join(WORK_DIR, 'state.json');
            HASH_FILE  = nodePath.join(WORK_DIR, 'hashes.json');
        } catch (e) {
            console.warn(PLUGIN_NAME + ': node modules unavailable, updater disabled.', e);
            fs = null;
        }
    }

    function resolveBaseDir() {
        try {
            if (process.mainModule && process.mainModule.filename) {
                return nodePath.dirname(process.mainModule.filename);
            }
        } catch (e) { /* fall through */ }
        try {
            return nodePath.dirname(process.execPath);
        } catch (e) {
            return '.';
        }
    }

    const isAvailable = () => !!fs;

    // =========================================================================
    // File helpers
    // =========================================================================
    function readFileAsync(file) {
        return new Promise((resolve, reject) => {
            fs.readFile(file, (err, data) => (err ? reject(err) : resolve(data)));
        });
    }
    function writeFileAsync(file, data) {
        return new Promise((resolve, reject) => {
            fs.writeFile(file, data, (err) => (err ? reject(err) : resolve()));
        });
    }
    function statAsync(file) {
        return new Promise((resolve) => {
            fs.stat(file, (err, st) => resolve(err ? null : st));
        });
    }
    function mkdirp(dir) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;
        }
    }
    function rmrf(target) {
        try {
            if (!fs.existsSync(target)) return;
            if (fs.rmSync) {
                fs.rmSync(target, { recursive: true, force: true });
            } else {
                fs.rmdirSync(target, { recursive: true });
            }
        } catch (e) {
            console.warn(PLUGIN_NAME + ': could not remove ' + target, e);
        }
    }
    function moveFile(from, to) {
        mkdirp(nodePath.dirname(to));
        try {
            fs.renameSync(from, to);
        } catch (e) {
            // Different volume or a locked target: fall back to copy + unlink.
            fs.copyFileSync(from, to);
            try { fs.unlinkSync(from); } catch (e2) { /* leave the temp file */ }
        }
    }
    function readJson(file, fallback) {
        try {
            if (!fs.existsSync(file)) return fallback;
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) {
            return fallback;
        }
    }
    function writeJson(file, data) {
        try {
            mkdirp(nodePath.dirname(file));
            fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
        } catch (e) {
            console.warn(PLUGIN_NAME + ': could not write ' + file, e);
        }
    }
    function blobSha(buffer) {
        const header = Buffer.from('blob ' + buffer.length + '\0', 'utf8');
        return crypto.createHash('sha1').update(Buffer.concat([header, buffer])).digest('hex');
    }

    // Git's own binary test: a NUL byte near the head of the file means the
    // bytes are data, not text, and must never be touched.
    function looksBinary(buffer) {
        const limit = Math.min(buffer.length, 8000);
        for (let i = 0; i < limit; i++) {
            if (buffer[i] === 0) return true;
        }
        return false;
    }

    // A text file checked out on Windows carries CRLF while the repository
    // stores LF, so the same content hashes differently and would be fetched
    // again on every single check. Hashing the LF form as well lets a file that
    // only differs in its line endings be recognised as the one we already have.
    function stripCR(buffer) {
        const out = Buffer.allocUnsafe(buffer.length);
        let n = 0;
        for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] === 13 && buffer[i + 1] === 10) continue;
            out[n++] = buffer[i];
        }
        return out.slice(0, n);
    }
    function sleepFrame() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    // A repository path is only accepted when it stays inside the game folder.
    function isSafePath(p) {
        if (!p || typeof p !== 'string') return false;
        if (p.indexOf('\0') >= 0) return false;
        if (p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p)) return false;
        if (p.split('/').some(seg => !seg || seg === '.' || seg === '..')) return false;
        return !EXCLUDED.some(ex => (ex.endsWith('/') ? p.startsWith(ex) : p === ex));
    }

    // =========================================================================
    // HTTP
    // =========================================================================
    function httpsGet(url, headers) {
        return new Promise((resolve, reject) => {
            const run = (target, depth) => {
                if (depth > 5) {
                    reject(new Error('too many redirects')); // i18n-ignore: diagnostic
                    return;
                }
                let parsed;
                try {
                    parsed = new URL(target);
                } catch (e) {
                    reject(new Error('bad url ' + target)); // i18n-ignore: diagnostic
                    return;
                }
                const req = https.get({
                    hostname: parsed.hostname,
                    path: parsed.pathname + parsed.search,
                    headers: Object.assign({
                        'User-Agent': USER_AGENT,
                        'Accept-Encoding': 'identity'
                    }, headers || {})
                }, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        res.resume();
                        run(new URL(res.headers.location, target).href, depth + 1);
                        return;
                    }
                    const chunks = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('end', () => {
                        const body = Buffer.concat(chunks);
                        if (res.statusCode !== 200) {
                            const detail = body.length ? ', ' + body.toString('utf8').slice(0, 160) : '';
                            reject(new Error('HTTP ' + res.statusCode + detail));
                            return;
                        }
                        resolve(body);
                    });
                    res.on('error', reject);
                });
                req.on('error', reject);
                req.setTimeout(TIMEOUT_MS, () => {
                    req.destroy(new Error('request timed out')); // i18n-ignore: diagnostic
                });
            };
            run(url, 0);
        });
    }

    // i18n-ignore-start: HTTP headers, API paths and repository URLs
    async function githubApi(pathname) {
        const body = await httpsGet('https://api.github.com' + pathname, {
            'Accept': 'application/vnd.github+json'
        });
        return JSON.parse(body.toString('utf8'));
    }

    function rawUrl(sha, filePath) {
        const encoded = filePath.split('/').map(encodeURIComponent).join('/');
        return `https://raw.githubusercontent.com/${OWNER}/${REPO}/${sha}/${encoded}`;
    }

    // =========================================================================
    // GameUpdater, the model behind the scene
    // =========================================================================
    const GameUpdater = {
        REPO_URL: `https://github.com/${OWNER}/${REPO}`, // i18n-ignore-end

        _state: null,
        _hashes: null,
        _plans: {},          // commit sha -> last check result
        _commits: [],        // branch history, newest first
        _historyPage: 0,
        _historyEnd: false,
        _busy: false,
        _cancelled: false,
        _restartPending: false,
        _auto: null,         // last launch check result
        _autoPromise: null,

        isAvailable,
        downloadsEnabled: () => DOWNLOADS_ENABLED,
        branch: BRANCH,
        baseCommit: BASE_COMMIT,

        state() {
            if (!this._state) {
                const raw = readJson(STATE_FILE, null) || {};
                // The old file kept one entry per channel; keep whichever build
                // that player actually had so the screen does not read "never".
                let installed = raw.installed || null;
                if (installed && !installed.sha) {
                    installed = installed[raw.channel] || installed.stable || installed.unstable || null;
                }
                this._state = {
                    installed: installed && installed.sha ? installed : null,
                    // sha -> how many commits came after the origin commit
                    builds: (raw.builds && typeof raw.builds === 'object') ? raw.builds : {}
                };
            }
            return this._state;
        },
        saveState() {
            writeJson(STATE_FILE, this.state());
        },
        installedInfo() {
            return this.state().installed;
        },

        // ---------------------------------------------------------------------
        // Build numbers, the count of commits made after the origin commit
        // ---------------------------------------------------------------------

        // The number of the build this copy is running, or null when it has
        // never updated and therefore cannot say which build it is.
        buildNumber() {
            const info = this.installedInfo();
            return info && typeof info.build === 'number' ? info.build : null;
        },
        knownBuildNumber(sha) {
            const cached = this.state().builds[sha];
            return typeof cached === 'number' ? cached : null;
        },

        // Writes the build number into the third field of a version string
        // ("0.0.1a - experimental" -> "0.0.42a - experimental"). A copy with no
        // build number keeps the string exactly as it was written.
        applyBuildNumber(text) {
            const build = this.buildNumber();
            if (build === null) return text;
            const str = String(text === undefined || text === null ? '' : text);
            if (!/\d+\.\d+\.\d+/.test(str)) return str;
            return str.replace(/(\d+\.\d+\.)(\d+)/, (m, head) => head + build);
        },

        // Asks the compare API how far a build sits from the origin commit. The
        // answer never changes for a given commit, so it is kept in the state
        // file and each build is only ever asked about once.
        async buildCountFor(sha) {
            if (!sha) return null;
            const known = this.knownBuildNumber(sha);
            if (known !== null) return known;

            let count;
            if (sha === BASE_COMMIT) {
                count = 0;
            } else {
                const cmp = await githubApi(
                    `/repos/${OWNER}/${REPO}/compare/${encodeURIComponent(BASE_COMMIT)}...${encodeURIComponent(sha)}` // i18n-ignore: api path
                );
                count = Number(cmp && cmp.ahead_by);
                if (!isFinite(count)) return null;
            }

            const st = this.state();
            st.builds[sha] = count;
            const keys = Object.keys(st.builds);
            while (keys.length > KEEP_BUILD_NUMBERS) delete st.builds[keys.shift()];
            // The installed record carries its own copy so the title screen can
            // number the badge without a single request.
            if (st.installed && st.installed.sha === sha) st.installed.build = count;
            this.saveState();
            return count;
        },

        // The one place the installed build is recorded, so its number is always
        // filled in from whatever the cache already knows.
        _markInstalled(sha, date) {
            const st = this.state();
            st.installed = {
                sha: sha,
                date: date || null,
                at: Date.now(),
                build: this.knownBuildNumber(sha)
            };
            this.saveState();
        },

        // ---------------------------------------------------------------------
        // Launch check, run once per session by the title screen
        // ---------------------------------------------------------------------
        autoResult() {
            return this._auto;
        },
        updateAvailable() {
            return !!(this._auto && this._auto.available);
        },
        autoPending() {
            return !!this._autoPromise && !this._auto;
        },

        // Idempotent: every caller after the first gets the same promise, so the
        // branch is read once however many times the title screen is entered.
        autoCheck() {
            if (this._autoPromise) return this._autoPromise;
            this._autoPromise = this._runAutoCheck().catch((err) => {
                this._auto = { ran: true, available: false, error: err && err.message ? err.message : String(err) };
                return this._auto;
            });
            return this._autoPromise;
        },

        async _runAutoCheck() {
            if (!isAvailable()) {
                this._auto = { ran: true, available: false, error: 'no local file system' }; // i18n-ignore: diagnostic
                return this._auto;
            }

            await this.loadHistory(false);
            const latest = this._commits[0];
            if (!latest) throw new Error('the branch holds no builds'); // i18n-ignore: diagnostic

            // A copy already recorded as running the newest build needs no file
            // comparison at all; anything else is measured against it.
            const installed = this.installedInfo();
            let plan = null;
            if (!installed || installed.sha !== latest.sha) {
                plan = await this.check(latest.sha);
            }

            let latestBuild = null;
            try {
                latestBuild = await this.buildCountFor(latest.sha);
                const now = this.installedInfo();
                if (now && now.sha !== latest.sha && typeof now.build !== 'number') {
                    await this.buildCountFor(now.sha);
                }
            } catch (e) {
                // Numbering is cosmetic: a failed compare must not cost the
                // player the update notice itself.
                console.warn(PLUGIN_NAME + ': could not resolve the build number', e);
            }

            this._auto = {
                ran: true,
                available: !!(plan && plan.changed.length),
                latest: latest.sha,
                latestDate: latest.date,
                latestBuild: latestBuild,
                build: this.buildNumber(),
                files: plan ? plan.changed.length : 0,
                bytes: plan ? plan.bytes : 0,
                error: null
            };
            return this._auto;
        },
        isInstalled(sha) {
            const info = this.installedInfo();
            return !!(info && sha && info.sha === sha);
        },
        plan(sha) {
            return this._plans[sha] || null;
        },
        commits() {
            return this._commits;
        },
        commitInfo(sha) {
            return this._commits.find(c => c.sha === sha) || null;
        },
        isLatest(sha) {
            return !!(this._commits.length && sha && this._commits[0].sha === sha);
        },
        // How far down the history a build sits, so an older one can say so.
        indexOf(sha) {
            return this._commits.findIndex(c => c.sha === sha);
        },
        historyExhausted() {
            return this._historyEnd;
        },
        isBusy() {
            return this._busy;
        },
        needsRestart() {
            return this._restartPending;
        },
        cancel() {
            if (this._busy) this._cancelled = true;
        },

        hashes() {
            if (!this._hashes) this._hashes = readJson(HASH_FILE, {}) || {};
            return this._hashes;
        },
        saveHashes() {
            writeJson(HASH_FILE, this.hashes());
        },

        // Hashes of a local file, cached on size + mtime so repeat checks are
        // cheap. `shaLF` is what the same file hashes to once CRLF endings are
        // normalised away, which is the form the repository holds; it costs a
        // second pass over the bytes, so it is only computed when asked for.
        async localHash(relPath, st, withLF) {
            const cache = this.hashes();
            const hit = cache[relPath];
            if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs &&
                (!withLF || hit.shaLF !== undefined)) {
                return hit;
            }
            const buf = await readFileAsync(nodePath.join(BASE_DIR, relPath));
            const record = { size: st.size, mtimeMs: st.mtimeMs, sha: blobSha(buf) };
            if (withLF) {
                record.shaLF = looksBinary(buf) ? null : blobSha(stripCR(buf));
            }
            cache[relPath] = record;
            return record;
        },

        // ---------------------------------------------------------------------
        // History, the builds on the branch, newest first
        // ---------------------------------------------------------------------
        async loadHistory(more, onProgress) {
            const T = getT();
            const report = onProgress || function () {};
            if (more && this._historyEnd) return this._commits;

            this._busy = true;
            this._cancelled = false;
            try {
                const page = more ? this._historyPage + 1 : 1;
                report({ phase: 'history', text: fmt(T.logHistory, BRANCH) });

                const list = await githubApi(
                    `/repos/${OWNER}/${REPO}/commits?sha=${encodeURIComponent(BRANCH)}&per_page=${PAGE_SIZE}&page=${page}` // i18n-ignore: api path
                );
                if (!Array.isArray(list)) throw new Error('branch ' + BRANCH + ' not found'); // i18n-ignore: diagnostic

                // The build list stops at the numbering origin: builds older than
                // it are never offered, so the oldest build a player can go back
                // to is build 0 and nothing before it is listed at all.
                const rows = [];
                let reachedOrigin = false;
                for (const c of list) {
                    if (!c || !c.sha) continue;
                    rows.push({
                        sha: c.sha,
                        date: c.commit && c.commit.author ? c.commit.author.date : null,
                        author: c.commit && c.commit.author ? c.commit.author.name : '',
                        message: c.commit ? String(c.commit.message || '').split('\n')[0] : ''
                    });
                    if (c.sha === BASE_COMMIT) { reachedOrigin = true; break; }
                }

                if (!more) this._commits = [];
                const seen = new Set(this._commits.map(c => c.sha));
                for (const row of rows) {
                    if (!seen.has(row.sha)) this._commits.push(row);
                }
                this._historyPage = page;
                this._historyEnd  = reachedOrigin || list.length < PAGE_SIZE;
                if (!this._commits.length) throw new Error('the branch holds no builds'); // i18n-ignore: diagnostic

                report({ phase: 'history', text: fmt(T.logHistoryFound, this._commits.length), ratio: 1 });
                return this._commits;
            } finally {
                this._busy = false;
            }
        },

        // ---------------------------------------------------------------------
        // Check, what does the chosen build hold that we do not
        // ---------------------------------------------------------------------
        async check(commitSha, onProgress) {
            const T = getT();
            const report = onProgress || function () {};
            if (!commitSha) return null;

            this._busy = true;
            this._cancelled = false;
            try {
                report({ phase: 'check', text: fmt(T.logChecking, shortSha(commitSha)) });

                // The history already carries the metadata; only a build reached
                // by some other route has to be looked up.
                let commit = this.commitInfo(commitSha);
                if (!commit) {
                    const raw = await githubApi(`/repos/${OWNER}/${REPO}/commits/${encodeURIComponent(commitSha)}`); // i18n-ignore: api path
                    if (!raw || !raw.sha) throw new Error('build ' + shortSha(commitSha) + ' not found'); // i18n-ignore: diagnostic
                    commit = {
                        sha: raw.sha,
                        date: raw.commit && raw.commit.author ? raw.commit.author.date : null,
                        author: raw.commit && raw.commit.author ? raw.commit.author.name : '',
                        message: raw.commit ? String(raw.commit.message || '').split('\n')[0] : ''
                    };
                }

                const tree = await githubApi(`/repos/${OWNER}/${REPO}/git/trees/${commit.sha}?recursive=1`); // i18n-ignore: api path
                if (tree.truncated) {
                    // A partial listing would quietly leave files behind, so refuse it.
                    throw new Error('the file listing came back truncated'); // i18n-ignore: diagnostic
                }
                const blobs = (tree.tree || []).filter(e => e.type === 'blob' && isSafePath(e.path));
                if (!blobs.length) throw new Error('the build holds no files we may write'); // i18n-ignore: diagnostic

                const changed = [];
                for (let i = 0; i < blobs.length; i++) {
                    if (this._cancelled) throw new Error('cancelled');
                    const entry = blobs[i];
                    const local = nodePath.join(BASE_DIR, entry.path);
                    const st = await statAsync(local);
                    const remoteSize = entry.size || 0;
                    if (!st || !st.isFile()) {
                        changed.push({ path: entry.path, sha: entry.sha, size: remoteSize, isNew: true });
                    } else if (st.size === remoteSize) {
                        // Same length: only the plain hash can make them equal.
                        const hash = await this.localHash(entry.path, st, false);
                        if (hash.sha !== entry.sha) {
                            changed.push({ path: entry.path, sha: entry.sha, size: remoteSize, isNew: false });
                        }
                    } else if (st.size > remoteSize) {
                        // Longer than the blob: it may be the very same text with
                        // CRLF endings, which is the only difference that makes a
                        // local file grow. Anything else really has changed.
                        const hash = await this.localHash(entry.path, st, true);
                        if (hash.shaLF !== entry.sha) {
                            changed.push({ path: entry.path, sha: entry.sha, size: remoteSize, isNew: false });
                        }
                    } else {
                        changed.push({ path: entry.path, sha: entry.sha, size: remoteSize, isNew: false });
                    }
                    if (i % 40 === 0) {
                        report({ phase: 'check', text: fmt(T.logCompare, i + 1, blobs.length), ratio: (i + 1) / blobs.length });
                        await sleepFrame();
                    }
                }
                this.saveHashes();

                const plan = {
                    branch: BRANCH,
                    sha: commit.sha,
                    date: commit.date,
                    author: commit.author,
                    message: commit.message,
                    total: blobs.length,
                    changed: changed,
                    bytes: changed.reduce((sum, c) => sum + (c.size || 0), 0),
                    checkedAt: Date.now()
                };
                this._plans[commit.sha] = plan;

                report({
                    phase: 'checked',
                    text: changed.length
                        ? fmt(T.logFound, changed.length, shortSha(commit.sha))
                        : fmt(T.logUpToDate, shortSha(commit.sha)),
                    ratio: 1
                });

                // Nothing to fetch means this build is the one we are running.
                if (!changed.length) {
                    this._markInstalled(commit.sha, plan.date);
                }
                return plan;
            } finally {
                this._busy = false;
            }
        },

        // ---------------------------------------------------------------------
        // Install, download everything first, replace only when all of it is here
        // ---------------------------------------------------------------------
        async install(commitSha, onProgress) {
            const T = getT();
            const plan = this._plans[commitSha];
            const report = onProgress || function () {};
            if (!DOWNLOADS_ENABLED) {
                report({ phase: 'blocked', text: T.downloadsOff });
                return null;
            }
            if (!plan || !plan.changed.length) return null;

            this._busy = true;
            this._cancelled = false;
            try {
                rmrf(TMP_DIR);
                mkdirp(TMP_DIR);

                const queue = plan.changed.slice();
                const total = queue.length;
                let done = 0;
                let failure = null;

                const worker = async () => {
                    for (;;) {
                        if (failure || this._cancelled) return;
                        const entry = queue.shift();
                        if (!entry) return;
                        try {
                            const body = await httpsGet(rawUrl(plan.sha, entry.path));
                            const sha = blobSha(body);
                            if (sha !== entry.sha) {
                                throw new Error('checksum mismatch for ' + entry.path); // i18n-ignore: diagnostic
                            }
                            const dest = nodePath.join(TMP_DIR, entry.path);
                            mkdirp(nodePath.dirname(dest));
                            await writeFileAsync(dest, body);
                            done++;
                            report({
                                phase: 'download',
                                text: fmt(T.logDownload, done, total, entry.path),
                                ratio: done / total
                            });
                        } catch (e) {
                            failure = new Error(entry.path + ', ' + e.message);
                            return;
                        }
                    }
                };

                const workers = [];
                for (let i = 0; i < Math.min(CONCURRENCY, total); i++) workers.push(worker());
                await Promise.all(workers);

                if (failure) {
                    // Nothing has been touched outside the staging folder yet.
                    rmrf(TMP_DIR);
                    throw failure;
                }
                if (this._cancelled) {
                    rmrf(TMP_DIR);
                    report({ phase: 'cancelled', text: T.logCancel, ratio: 0 });
                    return null;
                }

                // Every file is on disk and verified: now swap them in.
                report({ phase: 'apply', text: T.logApplying, ratio: 1 });
                const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupRoot = nodePath.join(BACKUP_DIR, stamp);
                let backedUp = 0;

                for (const entry of plan.changed) {
                    const target = nodePath.join(BASE_DIR, entry.path);
                    const staged = nodePath.join(TMP_DIR, entry.path);
                    if (!fs.existsSync(staged)) continue;
                    if (fs.existsSync(target)) {
                        const backup = nodePath.join(backupRoot, entry.path);
                        mkdirp(nodePath.dirname(backup));
                        try {
                            fs.copyFileSync(target, backup);
                            backedUp++;
                        } catch (e) {
                            console.warn(PLUGIN_NAME + ': could not back up ' + entry.path, e);
                        }
                    }
                    moveFile(staged, target);

                    const st = await statAsync(target);
                    if (st) this.hashes()[entry.path] = { size: st.size, mtimeMs: st.mtimeMs, sha: entry.sha };
                }

                this.saveHashes();
                rmrf(TMP_DIR);
                this.pruneBackups();

                this._markInstalled(plan.sha, plan.date);
                // The badge is numbered from the state file, so the build just
                // installed is numbered now rather than on the next launch.
                try {
                    await this.buildCountFor(plan.sha);
                } catch (e) {
                    console.warn(PLUGIN_NAME + ': could not resolve the build number', e);
                }
                // A build that is now the one running is no longer an update.
                if (this._auto) {
                    this._auto.available = false;
                    this._auto.build = this.buildNumber();
                }

                // Every other plan was measured against the files we just
                // replaced, so they have to be checked again.
                this._plans = {};
                plan.changed = [];
                plan.bytes = 0;
                this._plans[plan.sha] = plan;
                this._restartPending = true;

                if (backedUp) {
                    report({ phase: 'apply', text: fmt(T.logBackup, 'save/updater/backup/' + stamp) });
                }
                report({ phase: 'done', text: T.logDone, ratio: 1 });
                return plan;
            } finally {
                this._busy = false;
            }
        },

        pruneBackups() {
            try {
                if (!fs.existsSync(BACKUP_DIR)) return;
                const entries = fs.readdirSync(BACKUP_DIR).sort();
                while (entries.length > KEEP_BACKUPS) {
                    rmrf(nodePath.join(BACKUP_DIR, entries.shift()));
                }
            } catch (e) {
                console.warn(PLUGIN_NAME + ': could not prune backups', e);
            }
        },

        restart() {
            try {
                if (typeof nw !== 'undefined' && nw.Window && nw.Window.get()) {
                    nw.Window.get().reload();
                    return;
                }
            } catch (e) { /* fall through */ }
            try {
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.reload) {
                    chrome.runtime.reload();
                    return;
                }
            } catch (e) { /* fall through */ }
            window.location.reload();
        }
    };

    window.GameUpdater = GameUpdater;

    // =========================================================================
    // Input manager
    // =========================================================================
    const UpdaterInput = {
        _scene: null,
        _active: false,

        activate(scene) { this._scene = scene; this._active = true; },
        deactivate()    { this._active = false; this._scene = null; },

        update() {
            if (!this._active || !this._scene) return;
            const scene = this._scene;

            // WASD hold-repeat simulation, same shape as the mod manager screen.
            for (const dir of ['up', 'down', 'left', 'right']) {
                if (scene._wasdHeld[dir]) {
                    scene._wasdHoldFrames[dir]++;
                    const t = scene._wasdHoldFrames[dir];
                    if (t > Input.keyRepeatWait && (t - Input.keyRepeatWait) % Input.keyRepeatInterval === 0) {
                        scene._wasdInput[dir] = true;
                    }
                } else {
                    scene._wasdHoldFrames[dir] = 0;
                }
            }

            const isUp    = Input.isRepeated('up')    || scene._wasdInput.up;
            const isDown  = Input.isRepeated('down')  || scene._wasdInput.down;
            const isLeft  = Input.isRepeated('left')  || scene._wasdInput.left;
            const isRight = Input.isRepeated('right') || scene._wasdInput.right;
            scene._wasdInput.up = scene._wasdInput.down = scene._wasdInput.left = scene._wasdInput.right = false;

            if (Input.isTriggered('escape') || Input.isTriggered('cancel') || TouchInput.isCancelled()) {
                if (GameUpdater.isBusy()) {
                    SoundManager.playCancel();
                    GameUpdater.cancel();
                } else if (scene._section === 'actions') {
                    SoundManager.playCancel();
                    scene._section = 'builds';
                    scene._refreshDOM();
                } else {
                    SoundManager.playCancel();
                    SceneManager.pop();
                }
                return;
            }

            if (scene._section === 'builds') {
                const total = GameUpdater.commits().length;
                if (isUp && scene._buildIndex > 0) {
                    scene._buildIndex--;
                    SoundManager.playCursor();
                    scene._refreshDOM();
                } else if (isDown && scene._buildIndex < total - 1) {
                    scene._buildIndex++;
                    SoundManager.playCursor();
                    scene._refreshDOM();
                } else if (isRight) {
                    scene._section = 'actions';
                    scene._actionIndex = 0;
                    SoundManager.playCursor();
                    scene._refreshDOM();
                }
                if (Input.isTriggered('ok')) scene._useSelectedBuild();
            } else {
                const actions = scene._actions();
                if (isUp && scene._actionIndex > 0) {
                    scene._actionIndex--;
                    SoundManager.playCursor();
                    scene._updateActionHighlight();
                } else if (isDown && scene._actionIndex < actions.length - 1) {
                    scene._actionIndex++;
                    SoundManager.playCursor();
                    scene._updateActionHighlight();
                } else if (isLeft) {
                    scene._section = 'builds';
                    SoundManager.playCursor();
                    scene._refreshDOM();
                }
                if (Input.isTriggered('ok')) {
                    const action = actions[scene._actionIndex];
                    if (action) scene._runAction(action.key);
                }
            }
        }
    };

    // =========================================================================
    // Scene_GameUpdater
    // =========================================================================
    class Scene_GameUpdater extends Scene_MenuBase {
        create() {
            super.create();

            this._wasdInput      = { up: false, down: false, left: false, right: false };
            this._wasdHeld       = { up: false, down: false, left: false, right: false };
            this._wasdHoldFrames = { up: 0,     down: 0,     left: 0,     right: 0     };

            this._wasdListener = (e) => {
                if (e.repeat) return;
                const k = e.key.toLowerCase();
                if (k === 'w') { this._wasdInput.up    = true; this._wasdHeld.up    = true; e.preventDefault(); }
                if (k === 's') { this._wasdInput.down  = true; this._wasdHeld.down  = true; e.preventDefault(); }
                if (k === 'a') { this._wasdInput.left  = true; this._wasdHeld.left  = true; e.preventDefault(); }
                if (k === 'd') { this._wasdInput.right = true; this._wasdHeld.right = true; e.preventDefault(); }
            };
            this._wasdUpListener = (e) => {
                const k = e.key.toLowerCase();
                if (k === 'w') { this._wasdHeld.up    = false; this._wasdHoldFrames.up    = 0; }
                if (k === 's') { this._wasdHeld.down  = false; this._wasdHoldFrames.down  = 0; }
                if (k === 'a') { this._wasdHeld.left  = false; this._wasdHoldFrames.left  = 0; }
                if (k === 'd') { this._wasdHeld.right = false; this._wasdHoldFrames.right = 0; }
            };
            window.addEventListener('keydown', this._wasdListener);
            window.addEventListener('keyup',   this._wasdUpListener);

            this._buildIndex   = 0;
            this._section      = 'builds';
            this._actionIndex  = 0;
            this._log          = [];
            this._progress     = null;
            this._status       = {};   // commit sha -> 'checking' | 'failed'
            this._progressDirty = false;

            this._container = document.createElement('div');
            this._container.id = 'game-updater-container';
            this._container.style.opacity    = '0';
            this._container.style.transition = 'opacity 0.22s ease-out';
            document.body.appendChild(this._container);

            this._refreshDOM();
            UpdaterInput.activate(this);
            setTimeout(() => { if (this._container) this._container.style.opacity = '1'; }, 16);

            // Read the build list straight away, then check the newest one, so
            // the player sees an answer without pressing anything.
            if (isAvailable() && !GameUpdater.commits().length) {
                this._loadHistory(false, true);
            } else if (GameUpdater.autoPending()) {
                // The title screen's launch check is still running and has left
                // the list here already: take its answer when it lands rather
                // than leaving the page reading "not checked".
                GameUpdater.autoCheck().then(() => {
                    if (SceneManager._scene === this && this._container) this._refreshDOM();
                });
            }
        }

        update() {
            Scene_MenuBase.prototype.update.call(this);
            UpdaterInput.update();
            if (this._progressDirty) {
                this._progressDirty = false;
                this._updateProgressDOM();
            }
        }

        terminate() {
            if (this._wasdListener) {
                window.removeEventListener('keydown', this._wasdListener);
                window.removeEventListener('keyup',   this._wasdUpListener);
                this._wasdListener = this._wasdUpListener = null;
            }
            UpdaterInput.deactivate();
            if (this._container) {
                const c = this._container;
                c.style.transition    = 'opacity 0.2s ease-out';
                c.style.opacity       = '0';
                c.style.pointerEvents = 'none';
                setTimeout(() => { if (c.parentNode) c.parentNode.removeChild(c); }, 200);
                this._container = null;
            }
            Scene_MenuBase.prototype.terminate.call(this);
        }

        // -- state -----------------------------------------------------------

        _selectedBuild() {
            const list = GameUpdater.commits();
            if (!list.length) return null;
            this._buildIndex = Math.max(0, Math.min(this._buildIndex, list.length - 1));
            return list[this._buildIndex];
        }

        _buildStatus(commit) {
            const T = getT();
            if (!commit) return { text: T.unchecked, cls: 'gu-badge--idle' };
            if (this._status[commit.sha] === 'checking') return { text: T.checking, cls: 'gu-badge--busy' };
            if (this._status[commit.sha] === 'failed')   return { text: T.failed,   cls: 'gu-badge--bad' };
            const plan = GameUpdater.plan(commit.sha);
            if (!plan) return { text: T.unchecked, cls: 'gu-badge--idle' };
            if (plan.changed.length) {
                // Going back down the list is a rollback, not an update.
                const older = GameUpdater.indexOf(commit.sha) > 0;
                return { text: older ? T.differs : T.available, cls: 'gu-badge--new' };
            }
            return { text: T.upToDate, cls: 'gu-badge--ok' };
        }

        _actions() {
            const T = getT();
            const commit = this._selectedBuild();
            const plan = commit ? GameUpdater.plan(commit.sha) : null;
            const list = [];
            if (GameUpdater.isBusy()) {
                list.push({ key: 'cancel', label: T.actCancel });
                return list;
            }
            if (!isAvailable()) return list;
            if (!GameUpdater.commits().length) {
                list.push({ key: 'history', label: T.actHistory });
                return list;
            }
            list.push({ key: 'check', label: T.actCheck });
            if (DOWNLOADS_ENABLED && plan && plan.changed.length) {
                const isRollback = GameUpdater.indexOf(commit.sha) > 0;
                const verb = isRollback ? T.actRollback : T.actInstall;
                list.push({ key: 'install', label: fmt('%1 (%2)', verb, formatBytes(plan.bytes)) });
            }
            if (!GameUpdater.historyExhausted()) {
                list.push({ key: 'more', label: T.actMore });
            }
            if (GameUpdater.needsRestart()) {
                list.push({ key: 'restart', label: T.actRestart });
            }
            return list;
        }

        _pushLog(text) {
            if (!text) return;
            if (this._log[this._log.length - 1] === text) return;
            this._log.push(text);
            if (this._log.length > 6) this._log.shift();
        }

        _onProgress(info) {
            if (!info) return;
            if (info.text) this._pushLog(info.text);
            this._progress = (typeof info.ratio === 'number') ? info.ratio : this._progress;
            this._progressDirty = true;
        }

        // -- actions ---------------------------------------------------------

        // OK on a build checks it; a build already checked hands over to the
        // action list so the next press can install it.
        _useSelectedBuild() {
            const commit = this._selectedBuild();
            if (!isAvailable() || GameUpdater.isBusy() || !commit) return;
            if (GameUpdater.plan(commit.sha)) {
                this._section = 'actions';
                this._actionIndex = 0;
                SoundManager.playOk();
                this._refreshDOM();
                return;
            }
            this._runAction('check');
        }

        // `thenCheck` chains the first check onto the very first listing, so
        // opening the screen answers "is there a new build" on its own.
        _loadHistory(more, thenCheck) {
            const T = getT();
            if (!isAvailable() || GameUpdater.isBusy()) return;
            const before = GameUpdater.commits().length;
            this._progress = 0;
            this._refreshDOM();
            GameUpdater.loadHistory(more, (info) => this._onProgress(info))
                .then(() => {
                    this._progress = null;
                    if (more && GameUpdater.commits().length > before) {
                        this._buildIndex = before;
                    }
                    if (more && GameUpdater.commits().length === before) {
                        this._pushLog(T.logNoMore);
                    }
                    this._refreshDOM();
                    if (thenCheck && GameUpdater.commits().length) this._runAction('check');
                })
                .catch((err) => {
                    this._progress = null;
                    this._pushLog(fmt(T.logError, err.message));
                    this._refreshDOM();
                });
        }

        _runAction(key) {
            const T = getT();
            const commit = this._selectedBuild();

            if (key === 'cancel') {
                SoundManager.playCancel();
                GameUpdater.cancel();
                return;
            }
            if (!isAvailable()) {
                SoundManager.playBuzzer();
                this._pushLog(T.noNode);
                this._refreshDOM();
                return;
            }
            if (GameUpdater.isBusy()) return;

            if (key === 'history' || key === 'more') {
                SoundManager.playOk();
                this._loadHistory(key === 'more', key === 'history');
                return;
            }
            if (key === 'restart') {
                SoundManager.playOk();
                GameUpdater.restart();
                return;
            }
            if (!commit) {
                SoundManager.playBuzzer();
                return;
            }
            const sha = commit.sha;
            if (key === 'check') {
                SoundManager.playOk();
                this._status[sha] = 'checking';
                this._progress = 0;
                this._refreshDOM();
                GameUpdater.check(sha, (info) => this._onProgress(info))
                    .then(() => {
                        delete this._status[sha];
                        this._progress = null;
                        this._refreshDOM();
                    })
                    .catch((err) => {
                        this._status[sha] = 'failed';
                        this._progress = null;
                        this._pushLog(fmt(T.logError, err.message));
                        this._refreshDOM();
                    });
                return;
            }
            if (key === 'install') {
                if (!DOWNLOADS_ENABLED) {
                    SoundManager.playBuzzer();
                    this._pushLog(T.downloadsOff);
                    this._refreshDOM();
                    return;
                }
                SoundManager.playOk();
                this._progress = 0;
                this._refreshDOM();
                GameUpdater.install(sha, (info) => this._onProgress(info))
                    .then(() => {
                        this._progress = null;
                        this._actionIndex = 0;
                        this._refreshDOM();
                    })
                    .catch((err) => {
                        this._progress = null;
                        this._pushLog(fmt(T.logError, err.message));
                        this._refreshDOM();
                    });
            }
        }

        // -- HTML ------------------------------------------------------------

        _buildLeftPageHTML(T) {
            const commits = GameUpdater.commits();
            const rows = commits.length ? commits.map((commit, i) => {
                const sel    = i === this._buildIndex && this._section === 'builds';
                const status = this._buildStatus(commit);
                const tag = GameUpdater.isInstalled(commit.sha) ? T.tagInstalled
                    : (i === 0 ? T.tagLatest : '');
                return `
                    <div class="gu-build${sel ? ' selected' : ''}" data-idx="${i}">
                        <div class="gu-build-head">
                            <span class="gu-build-sha">${esc(shortSha(commit.sha))}</span>
                            <span class="gu-build-date">${esc(formatDate(commit.date) || T.unknown)}</span>
                            ${tag ? `<span class="gu-build-tag">${esc(tag)}</span>` : ''}
                        </div>
                        <div class="gu-build-message">${esc(commit.message || T.unknown)}</div>
                        <div class="gu-build-foot">
                            <span class="gu-badge ${status.cls}">${status.text}</span>
                            <span class="gu-build-sub">${esc(commit.author || '')}</span>
                        </div>
                    </div>`;
            }).join('') : `<div class="gu-build-empty">${esc(T.noBuilds)}</div>`;

            const logHTML = this._log.map(line => `<div class="gu-log-line">${esc(line)}</div>`).join('');
            const pct = this._progress === null || this._progress === undefined
                ? null : Math.round(Math.max(0, Math.min(1, this._progress)) * 100);

            return `
                <div class="page-header-bar">
                    <button class="back-button" id="gu-back-btn">${T.back}</button>
                    <h2 class="title">${T.title}</h2>
                </div>
                <div class="gu-build-header">${fmt(T.buildsOn, BRANCH)}</div>
                <div class="gu-build-list" id="gu-build-list">${rows}</div>
                <div class="gu-console" id="gu-console">
                    <div class="gu-log" id="gu-log">${logHTML}</div>
                    <div class="gu-progress${pct === null ? ' gu-progress--idle' : ''}" id="gu-progress">
                        <div class="gu-progress-fill" id="gu-progress-fill" style="width:${pct === null ? 0 : pct}%"></div>
                    </div>
                </div>
                <div class="mod-hint-bar">${T.hint}</div>`;
        }

        _buildRightPageHTML(T) {
            const commit = this._selectedBuild();
            const plan = commit ? GameUpdater.plan(commit.sha) : null;
            const installed = GameUpdater.installedInfo();
            const status = this._buildStatus(commit);
            const position = commit ? GameUpdater.indexOf(commit.sha) : -1;

            const row = (label, value) => `
                <div class="inspect-spec-row">
                    <span class="inspect-spec-label">${esc(label)}</span>
                    <span class="inspect-spec-value">${esc(value)}</span>
                </div>`;

            let specs = '';
            specs += row(T.branch, BRANCH);
            specs += row(T.installed, installed
                ? `${shortSha(installed.sha)}  (${formatDate(installed.at ? new Date(installed.at).toISOString() : null) || T.unknown})`
                : T.never);
            // The number the version badge wears, when this copy knows it.
            const ownBuild = GameUpdater.buildNumber();
            if (ownBuild !== null) specs += row(T.buildNumber, ownBuild);
            if (commit) {
                specs += row(T.selected, shortSha(commit.sha));
                specs += row(T.committed, formatDate(commit.date) || T.unknown);
                if (commit.author) specs += row(T.author, commit.author);
                if (commit.message) specs += row(T.message, commit.message);
                specs += row(T.age, position <= 0 ? T.tagLatest : fmt(T.buildsBack, position));
            }
            if (plan) {
                specs += row(T.tracked, plan.total);
                specs += row(DOWNLOADS_ENABLED ? T.toUpdate : T.changedFiles, plan.changed.length);
                if (DOWNLOADS_ENABLED && plan.changed.length) specs += row(T.download, formatBytes(plan.bytes));
            }

            const actions = this._actions().map((a, i) => {
                const sel = this._section === 'actions' && i === this._actionIndex;
                return `<button class="inspect-btn${sel ? ' selected' : ''}" data-action="${a.key}">${esc(a.label)}</button>`;
            }).join('');

            let fileList = '';
            if (plan && plan.changed.length) {
                const shown = plan.changed.slice(0, 60);
                const rest  = plan.changed.length - shown.length;
                fileList = `
                    <div class="gu-files">
                        <div class="gu-files-header">${DOWNLOADS_ENABLED ? T.listHeader : T.listHeaderChanged}</div>
                        ${shown.map(c => `<div class="gu-file-row"><span class="gu-file-flag">${c.isNew ? '+' : '~'}</span><span class="gu-file-path">${esc(c.path)}</span><span class="gu-file-size">${formatBytes(c.size)}</span></div>`).join('')}
                        ${rest > 0 ? `<div class="gu-file-more">${fmt(T.andMore, rest)}</div>` : ''}
                    </div>`;
            }

            let note = '';
            if (!isAvailable()) {
                note = `<div class="gu-note gu-note--bad">${T.noNode}</div>`;
            } else if (!DOWNLOADS_ENABLED) {
                note = `<div class="gu-note">${T.downloadsOff}</div>`;
            } else if (GameUpdater.needsRestart()) {
                note = `<div class="gu-note">${T.restartNote}</div>`;
            } else if (position > 0 && plan && plan.changed.length) {
                // Installing this one walks the game backwards; say so plainly.
                note = `<div class="gu-note">${esc(T.olderNote)}</div>`;
            }

            const heading = commit
                ? fmt(T.buildName, shortSha(commit.sha))
                : T.noBuilds;

            return `
                <div class="item-inspect">
                    <div class="inspect-header">
                        <div class="inspect-title-box">
                            <div class="inspect-name">${esc(heading)}</div>
                            <div class="inspect-rarity">${status.text}</div>
                        </div>
                    </div>
                    ${note}
                    <div class="inspect-lore">
                        ${specs}
                        <div class="inspect-spec-row">
                            <span class="inspect-spec-label">${esc(T.source)}</span>
                            <span class="inspect-spec-value mod-path-value">${esc(GameUpdater.REPO_URL)}</span>
                        </div>
                    </div>
                    <div class="inspect-actions">${actions}</div>
                    ${fileList}
                </div>`;
        }

        _refreshDOM() {
            if (!this._container) return;
            const T = getT();
            this._container.innerHTML = `
                <div class="book-spread">
                    <div class="left-page" id="gu-left-page">${this._buildLeftPageHTML(T)}</div>
                    <div class="right-page" id="gu-right-page">${this._buildRightPageHTML(T)}</div>
                </div>`;
            this._wireEvents();
            this._scrollSelectedIntoView();
        }

        // The history is long enough to scroll, so the cursor has to drag the
        // list along with it.
        _scrollSelectedIntoView() {
            if (!this._container || this._section !== 'builds') return;
            const node = this._container.querySelector('.gu-build.selected');
            if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
        }

        // Progress ticks come in far faster than a full re-render can keep up
        // with, so they only touch the bar and the log.
        _updateProgressDOM() {
            if (!this._container) return;
            const log = this._container.querySelector('#gu-log');
            if (log) {
                log.innerHTML = this._log.map(line => `<div class="gu-log-line">${esc(line)}</div>`).join('');
                log.scrollTop = log.scrollHeight;
            }
            const bar  = this._container.querySelector('#gu-progress');
            const fill = this._container.querySelector('#gu-progress-fill');
            if (bar && fill) {
                const idle = this._progress === null || this._progress === undefined;
                bar.classList.toggle('gu-progress--idle', idle);
                fill.style.width = idle ? '0%' : Math.round(Math.max(0, Math.min(1, this._progress)) * 100) + '%';
            }
        }

        _updateActionHighlight() {
            if (!this._container) return;
            this._container.querySelectorAll('.inspect-btn[data-action]').forEach((btn, i) => {
                btn.classList.toggle('selected', this._section === 'actions' && i === this._actionIndex);
            });
        }

        _wireEvents() {
            const back = this._container.querySelector('#gu-back-btn');
            if (back) {
                back.addEventListener('click', () => {
                    SoundManager.playCancel();
                    if (GameUpdater.isBusy()) GameUpdater.cancel();
                    else SceneManager.pop();
                });
            }

            this._container.querySelectorAll('.gu-build').forEach(node => {
                node.addEventListener('click', () => {
                    const idx = parseInt(node.dataset.idx, 10);
                    if (idx === this._buildIndex && this._section === 'builds') {
                        this._useSelectedBuild();
                    } else {
                        this._buildIndex = idx;
                        this._section = 'builds';
                        SoundManager.playCursor();
                        this._refreshDOM();
                    }
                });
            });

            this._container.querySelectorAll('.inspect-btn[data-action]').forEach((btn, i) => {
                btn.addEventListener('mouseover', () => {
                    if (this._section !== 'actions') return;
                    this._actionIndex = i;
                    this._updateActionHighlight();
                });
                btn.addEventListener('click', () => {
                    this._section = 'actions';
                    this._actionIndex = i;
                    this._runAction(btn.dataset.action);
                });
            });
        }
    }

    window.Scene_GameUpdater = Scene_GameUpdater;

    // =========================================================================
    // Title screen entry, inserted just above EXIT
    // =========================================================================
    if (isAvailable()) {
        const _makeCommandList = Window_TitleCommand.prototype.makeCommandList;
        Window_TitleCommand.prototype.makeCommandList = function () {
            _makeCommandList.call(this);
            const at = this._list.findIndex(c => c.symbol === 'exitGame');
            const entry = { name: getT().menu, symbol: 'gameUpdater', enabled: true, ext: null };
            if (at >= 0) this._list.splice(at, 0, entry);
            else this._list.push(entry);
        };

        const _createCommandWindow = Scene_Title.prototype.createCommandWindow;
        Scene_Title.prototype.createCommandWindow = function () {
            _createCommandWindow.call(this);
            this._commandWindow.setHandler('gameUpdater', this.commandGameUpdater.bind(this));
        };

        Scene_Title.prototype.commandGameUpdater = function () {
            SceneManager.push(Scene_GameUpdater);
        };

        // The title screen draws its own DOM list from getTitleCommandText and
        // maps the clicked index straight onto the command window, so the entry
        // has to be spliced into that list at the very same place.
        if (Scene_Title.prototype.getTitleCommandText) {
            const _getTitleCommandText = Scene_Title.prototype.getTitleCommandText;
            Scene_Title.prototype.getTitleCommandText = function () {
                const commands = _getTitleCommandText.call(this);
                const at = commands.findIndex(c => c.symbol === 'exitGame');
                const entry = { text: getT().menu, symbol: 'gameUpdater' };
                if (at >= 0) commands.splice(at, 0, entry);
                else commands.push(entry);
                return commands;
            };
        }
    }
})();
