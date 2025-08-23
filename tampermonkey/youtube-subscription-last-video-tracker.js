// ==UserScript==
// @name         Youtube Subscription Last Video Tracker
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Track and find your last watched video(s) on YouTube subscriptions page.
// @author       volkan.cicek
// @match        https://www.youtube.com/feed/subscriptions*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // --- Utility Functions ---
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func.apply(this, args); // Use apply to preserve 'this' context
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // --- Configuration ---
    const DEFAULT_CONFIG = {
        MAX_STORED_VIDEOS: 10,
        STORAGE_KEY: 'yt_sub_tracker_last_watched',
        SCROLL_OFFSET: 150,
        HIGHLIGHT_DURATION: 2500,
        HIGHLIGHT_COLOR: 'rgba(255, 215, 0, 0.4)',
        DEBOUNCE_DELAY: 300,
        ACTION_DELAY: 500,
        INIT_DELAY: 1500,
        MAX_SCROLL_ATTEMPTS: 10,
        ELEMENT_WAIT_TIMEOUT: 5000,
        STATUS_MESSAGE_DURATION: 2000, // How long to show "Updated" / "Found!" (ms)
        MAX_INIT_ATTEMPTS: 10, // Maximum number of initialization attempts
        INIT_RETRY_DELAY: 1000, // Delay between initialization attempts
        // Filter keywords for excluding live/streamed content
        LIVE_STREAM_KEYWORDS: ['yayınlandı', 'canlı', 'streamed'],
    };

    // --- Constants ---
    const SELECTORS = {
        VIDEO_ITEM: 'ytd-rich-item-renderer, ytd-grid-video-renderer',
        VIDEO_LINK: 'a#video-title-link',
        VIDEO_THUMBNAIL_LINK: 'a#thumbnail',
        VIDEO_TITLE: '#video-title',
        VIDEO_META_BLOCK: 'ytd-video-meta-block',
        CHANNEL_NAME: '#channel-name a, ytd-channel-name a',
        ORIGINAL_SECTION_TARGET: '#primary ytd-section-list-renderer, #primary ytd-rich-grid-renderer, #dismissible.style-scope.ytd-shelf-renderer',
        ORIGINAL_TITLE_TARGET: 'h2, yt-formatted-string.title, #title-container h2 #title',
        ORIGINAL_FALLBACK_PARENT: 'ytd-page-manager',
        SHORTS_VIDEO: '[overlay-style="SHORTS"]',
        LIVE_BADGE: '.badge-style-type-live-now',
        UPCOMING_BADGE: '.badge-style-type-live-now-alternate',
        CONTINUATION_ITEM: 'ytd-continuation-item-renderer',
        SPINNER: '#spinnerContainer.active, #spinner.ytd-feed-filter-chip-bar-renderer',
        UI_CONTAINER_ID: 'yt-sub-tracker-ui',
        RECENT_UPLOADS_SECTION: '#dismissible.style-scope.ytd-shelf-renderer',
        RECENT_UPLOADS_TITLE: '#title-container h2 #title',
        RECENT_UPLOADS_HEADER: '#title-container',
    };

    // --- Simplified UI Text ---
    const UI_TEXT = {
        GO_TO_LAST_BUTTON: "Go to Last Video",
        UPDATE_LIST_BUTTON: "Update Marker",
        STATUS_UPDATED: "Updated!",
        STATUS_FOUND: "Found!",
    };

    // Keep colors for potential future use or subtle effects
    const STATUS_COLORS = {
        IDLE: '#ccc',
        ACTIVE: '#87ceeb',
        SUCCESS: '#90ee90',
        WARNING: '#ffd700',
        ERROR: '#ff6347',
    };

    // --- YouTube Tracker Class ---
    class YouTubeTracker {
        constructor(config) {
            this.config = { ...DEFAULT_CONFIG, ...config };
            this.state = {
                isSearching: false,
                lastVideos: [],
                hasUnsavedChanges: false,
                uiElements: {
                    container: null,
                    statusText: null,
                    goToButton: this._createButton(UI_TEXT.GO_TO_LAST_BUTTON, '#f00',
                        debounce(this.findAndGoToLastWatched.bind(this), this.config.DEBOUNCE_DELAY)
                    ),
                    updateButton: this._createButton(UI_TEXT.UPDATE_LIST_BUTTON, '#3ea6ff',
                        debounce(this.updateLastWatchedList.bind(this), this.config.DEBOUNCE_DELAY)
                    )
                },
                scrollAttempts: 0,
                statusTimeout: null,
                initAttempts: 0,
            };
            this.debouncedHandlePageChange = debounce(this._handlePageChange.bind(this), this.config.DEBOUNCE_DELAY * 2);
            this.state.lastVideos = this._loadData(this.config.STORAGE_KEY, []);
            console.log("YT Sub Tracker (Minimal UI): Initialized. Loaded markers:", this.state.lastVideos);

            // Add event listeners for tab closing
            window.addEventListener('beforeunload', this._handleBeforeUnload.bind(this));
            document.addEventListener('visibilitychange', this._handleVisibilityChange.bind(this));

            // Start initialization process
            this._startInitialization();
        }

        // Add method to handle beforeunload event
        _handleBeforeUnload(event) {
            if (this.state.hasUnsavedChanges) {
                event.preventDefault();
                event.returnValue = 'You have unsaved changes. Did you save your last watched position?';
                return event.returnValue;
            }
        }

        // Add method to handle visibility change
        _handleVisibilityChange() {
            if (document.visibilityState === 'hidden') {
                // Tab is being closed or hidden
                if (this.state.hasUnsavedChanges) {
                    // Store the current URL and timestamp in localStorage
                    const warningData = {
                        url: window.location.href,
                        timestamp: Date.now(),
                        message: 'You had unsaved changes when closing the tab. Did you save your last watched position?'
                    };
                    localStorage.setItem('yt_sub_tracker_warning', JSON.stringify(warningData));
                }
            }
        }

        // Modify updateLastWatchedList to clear warning data
        async updateLastWatchedList() {
            if (this.state.isSearching) return;
            this.setStatus(''); // Clear previous status

            // Indicate activity by disabling button immediately
            this.state.uiElements?.updateButton?.setAttribute('disabled', 'true');
            this.state.uiElements?.goToButton?.setAttribute('disabled', 'true'); // Disable both during update
            await this._wait(50); // Short delay to allow UI redraw

            const visibleVideos = this.findVisibleVideos();

            if (visibleVideos.length === 0) {
                console.warn("YT Sub Tracker: No videos found on screen to set marker.");
                // No visual feedback needed as per requirement
            } else {
                const videosToStore = visibleVideos
                    .slice(0, this.config.MAX_STORED_VIDEOS)
                    .map(v => ({
                        id: v.id,
                        title: v.title,
                        channel: v.channel,
                        timestamp: Date.now()
                    }));

                this.state.lastVideos = videosToStore;
                this._saveData(this.config.STORAGE_KEY, this.state.lastVideos);
                this.state.hasUnsavedChanges = false; // Reset unsaved changes flag
                // Clear any existing warning data
                localStorage.removeItem('yt_sub_tracker_warning');
                this.setStatus(UI_TEXT.STATUS_UPDATED, STATUS_COLORS.SUCCESS); // Show temporary message
                console.log("YT Sub Tracker: Updated marker with videos:", this.state.lastVideos);
            }

            // Re-enable buttons and potentially clear message after delay
            await this._wait(50); // Wait briefly before re-enabling
            this.state.uiElements?.updateButton?.removeAttribute('disabled');
            this.state.uiElements?.goToButton?.removeAttribute('disabled');
            this.updateUI(); // Update button states (GoTo might now be enabled)

            // Clear the "Updated" message after a duration
            if (this.state.uiElements?.statusText.textContent === UI_TEXT.STATUS_UPDATED) {
                this._clearStatusAfterDelay();
            }
        }

        // Add method to check for warning on page load
        _checkForWarning() {
            try {
                const warningData = localStorage.getItem('yt_sub_tracker_warning');
                if (warningData) {
                    const data = JSON.parse(warningData);
                    // Only show warning if it's from the same URL and within last 5 minutes
                    if (data.url === window.location.href &&
                        (Date.now() - data.timestamp) < 5 * 60 * 1000) {
                        alert(data.message);
                        localStorage.removeItem('yt_sub_tracker_warning');
                    }
                }
            } catch (e) {
                console.error('YT Sub Tracker: Error checking warning:', e);
            }
        }

        // Modify _startInitialization to check for warning
        _startInitialization() {
            // Check for warning first
            this._checkForWarning();

            // Wait for document to be ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    setTimeout(() => this._attemptInitialization(), this.config.INIT_DELAY);
                });
            } else {
                setTimeout(() => this._attemptInitialization(), this.config.INIT_DELAY);
            }
        }

        // Attempt to initialize UI with retry mechanism
        _attemptInitialization() {
            // Check if we've reached max attempts
            if (this.state.initAttempts >= this.config.MAX_INIT_ATTEMPTS) {
                console.warn("YT Sub Tracker: Max initialization attempts reached. UI may not be placed correctly.");
                return;
            }

            this.state.initAttempts++;
            console.log(`YT Sub Tracker: Initialization attempt ${this.state.initAttempts}/${this.config.MAX_INIT_ATTEMPTS}`);

            // Check if the page is ready for UI placement
            const isPageReady = this._isPageReadyForUI();

            if (isPageReady) {
                console.log("YT Sub Tracker: Page is ready, initializing UI");
                this.initializeUI();
                this.setupObserver();
            } else {
                console.log("YT Sub Tracker: Page not ready yet, will retry");
                setTimeout(() => this._attemptInitialization(), this.config.INIT_RETRY_DELAY);
            }
        }

        // Check if the page is ready for UI placement
        _isPageReadyForUI() {
            // Check if we're on a video watch page - don't show UI there
            if (window.location.href.includes('/watch?v=')) {
                return false;
            }

            // Check for key elements that indicate the page is ready
            const hasRecentUploadsSection = !!document.querySelector(SELECTORS.RECENT_UPLOADS_SECTION);
            const hasPageSection = !!document.querySelector(SELECTORS.ORIGINAL_SECTION_TARGET);
            const hasFallbackParent = !!document.querySelector(SELECTORS.ORIGINAL_FALLBACK_PARENT);

            // Page is ready if any of these elements exist
            return hasRecentUploadsSection || hasPageSection || hasFallbackParent;
        }

        // --- Core Logic ---
        async findAndGoToLastWatched() {
            if (this.state.isSearching) return;
            if (this.state.lastVideos.length === 0) {
                console.warn("YT Sub Tracker: 'Go to Last Video' clicked, but no marker set.");
                // No visual feedback needed
                return;
            }

            this.state.isSearching = true;
            this.state.scrollAttempts = 0;
            this.setStatus(''); // Clear previous status
            this.uiElements?.goToButton?.setAttribute('disabled', 'true');
            this.uiElements?.updateButton?.setAttribute('disabled', 'true');

            let found = false;
            try {
                found = await this._searchLoop();
            } catch (error) {
                console.error("YT Sub Tracker: Error during search:", error);
                // No visual error message needed
            } finally {
                this.state.isSearching = false;

                // Re-enable buttons first
                this.uiElements?.goToButton?.removeAttribute('disabled');
                this.uiElements?.updateButton?.removeAttribute('disabled');
                this.updateUI(); // Update button states

                // If found, the "Found!" message is already showing. Clear it after delay.
                // If not found, just ensure status is clear.
                if (found) {
                    this._clearStatusAfterDelay();
                } else {
                    this.setStatus(''); // Ensure status is clear if not found
                }
            }
        }

        async _searchLoop() {
            while (this.state.scrollAttempts < this.config.MAX_SCROLL_ATTEMPTS) {
                const currentVideos = this.findVisibleVideos();

                for (const lastVideo of this.state.lastVideos) {
                    const foundVideo = currentVideos.find(v => v.id === lastVideo.id);
                    if (foundVideo) {
                        this.setStatus(UI_TEXT.STATUS_FOUND, STATUS_COLORS.SUCCESS); // Show found message
                        this._scrollToElement(foundVideo.element);
                        this._highlightElement(foundVideo.element);
                        // Don't clear status here, handled in `findAndGoToLastWatched` finally block
                        return true; // Found!
                    }
                }

                // Not found on current screen
                if (await this._canLoadMore()) {
                    // No status update for scrolling needed
                    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                    this.state.scrollAttempts++;
                    await this._waitForLoad();
                } else {
                    return false; // End of feed or cannot load more
                }
                await this._wait(this.config.ACTION_DELAY); // Small delay between attempts
            }
            return false; // Max scroll attempts reached
        }

        // --- DOM Interaction (findVisibleVideos, _scrollToElement, _highlightElement, _canLoadMore, _waitForLoad) ---
        findVisibleVideos() {
            const videoElements = [];
            const elements = document.querySelectorAll(SELECTORS.VIDEO_ITEM);
            for (const element of elements) {
                const rect = element.getBoundingClientRect();
                if (rect.bottom < -200 || rect.top > window.innerHeight + 200) { }
                
                if (this._shouldSkipVideo(element)) {
                    continue;
                }
                
                const videoData = this._extractVideoData(element);
                if (videoData) {
                    videoElements.push(videoData);
                }
            }
            videoElements.sort((a, b) => a.position - b.position);

            // Set hasUnsavedChanges if we found videos and they're different from last saved
            if (videoElements.length > 0) {
                const currentVideoIds = videoElements.slice(0, this.config.MAX_STORED_VIDEOS).map(v => v.id);
                const lastVideoIds = this.state.lastVideos.map(v => v.id);
                this.state.hasUnsavedChanges = !this._areArraysEqual(currentVideoIds, lastVideoIds);
            }

            return videoElements;
        }

        _shouldSkipVideo(element) {
            // Skip shorts, live badges, and upcoming content
            if (element.querySelector(SELECTORS.SHORTS_VIDEO) ||
                element.querySelector(SELECTORS.LIVE_BADGE) ||
                element.querySelector(SELECTORS.UPCOMING_BADGE)) {
                return true;
            }

            // Skip past live/streamed content based on metadata text
            const metaBlock = element.querySelector(SELECTORS.VIDEO_META_BLOCK);
            const metaText = metaBlock ? (metaBlock.textContent || '').toLowerCase() : '';
            if (this.config.LIVE_STREAM_KEYWORDS.some(keyword => metaText.includes(keyword))) {
                return true;
            }

            return false;
        }

        _extractVideoData(element) {
            // Extract video link and ID
            const linkElement = element.querySelector(SELECTORS.VIDEO_LINK) || element.querySelector(SELECTORS.VIDEO_THUMBNAIL_LINK);
            if (!linkElement?.href?.includes('watch?v=')) {
                return null;
            }

            const href = linkElement.href;
            const match = href.match(/watch\?v=([^&]+)/);
            if (!match || !match[1]) {
                return null;
            }

            const videoId = match[1];
            
            // Extract title and channel
            const titleElement = element.querySelector(SELECTORS.VIDEO_TITLE);
            const channelElement = element.querySelector(SELECTORS.CHANNEL_NAME);
            const title = titleElement ? titleElement.textContent.trim() : 'Unknown Video';
            const channel = channelElement ? channelElement.textContent.trim() : 'Unknown Channel';

            // Calculate position
            const rect = element.getBoundingClientRect();
            const position = rect.top + window.scrollY;

            return {
                id: videoId,
                title: title,
                channel: channel,
                element: element,
                position: position
            };
        }

        _scrollToElement(element) {
            const targetY = element.getBoundingClientRect().top + window.scrollY - this.config.SCROLL_OFFSET;
            window.scrollTo({ top: targetY, behavior: 'smooth' });
        }
        _highlightElement(element) {
            const originalStyle = element.style.cssText;
            element.style.transition = 'background-color 0.3s ease-in-out, box-shadow 0.3s ease-in-out, border-radius 0.3s ease-in-out';
            element.style.backgroundColor = this.config.HIGHLIGHT_COLOR;
            element.style.boxShadow = `0 0 15px 5px ${this.config.HIGHLIGHT_COLOR}`;
            element.style.borderRadius = '8px';
            setTimeout(() => { element.style.cssText = originalStyle; }, this.config.HIGHLIGHT_DURATION);
        }
        async _canLoadMore() {
            return !!document.querySelector(SELECTORS.CONTINUATION_ITEM) || !!document.querySelector(SELECTORS.SPINNER);
        }
        async _waitForLoad(timeout = this.config.ELEMENT_WAIT_TIMEOUT) {
            const startTime = Date.now();
            let spinner = document.querySelector(SELECTORS.SPINNER);
            let didSpinnerExist = !!spinner;
            if (spinner) {
                while (spinner && (Date.now() - startTime < timeout)) {
                    await this._wait(200);
                    spinner = document.querySelector(SELECTORS.SPINNER);
                }
            }
            const minWait = didSpinnerExist ? this.config.ACTION_DELAY / 2 : this.config.ACTION_DELAY;
            const elapsed = Date.now() - startTime;
            if (elapsed < minWait) { await this._wait(minWait - elapsed); }
            await this._wait(100);
        }

        // --- UI Methods ---
        async initializeUI() {
            if (document.getElementById(SELECTORS.UI_CONTAINER_ID)) {
                this.updateUI();
                return;
            }

            // Wait for Recent uploads section with timeout
            let attempts = 0;
            const maxAttempts = 20; // Maximum 10 attempts
            const waitTime = 1000; // Wait 1 second between attempts

            while (attempts < maxAttempts) {
                const recentUploadsSection = document.querySelector(SELECTORS.RECENT_UPLOADS_SECTION);
                const titleContainer = recentUploadsSection?.querySelector(SELECTORS.RECENT_UPLOADS_HEADER);

                if (recentUploadsSection && titleContainer) {
                    const container = this.createUI();
                    if (!container) return;

                    titleContainer.insertAdjacentElement('beforeend', container);
                    container.style.position = '';
                    container.style.top = '';
                    container.style.right = '';
                    container.style.zIndex = '';
                    container.style.backgroundColor = '';
                    container.style.border = '';
                    container.style.boxShadow = '';
                    container.style.margin = '10px 16px 10px 0';

                    const buttonContainer = container.querySelector('div:last-of-type');
                    if (buttonContainer) {
                        buttonContainer.style.flexDirection = 'row';
                        buttonContainer.style.justifyContent = 'flex-start';
                    }

                    this.state.uiElements.statusText.style.flexShrink = '1';
                    this.state.uiElements.statusText.style.minWidth = '10px';
                    this.state.uiElements.statusText.style.textAlign = 'left';

                    this.updateUI();
                    return;
                }

                attempts++;
                if (attempts < maxAttempts) {
                    await this._wait(waitTime);
                }
            }

            console.warn("YT Sub Tracker: Recent uploads section not found after maximum attempts");
        }

        createUI() {
            const container = document.createElement("div");
            container.id = SELECTORS.UI_CONTAINER_ID;
            container.style.cssText = `
                background-color: var(--yt-spec-brand-background-solid, #212121);
                color: var(--yt-spec-text-primary, #fff);
                padding: 6px 8px;
                border-radius: 20px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                font-family: "Roboto", Arial, sans-serif;
                font-size: 13px;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                transition: opacity 0.3s ease;
            `;

            // Status Display - Now minimalist
            const statusText = document.createElement("div");
            statusText.style.cssText = `
                font-weight: 500;
                padding: 0 4px;
                color: ${STATUS_COLORS.SUCCESS};
                min-height: 1.2em;
                display: inline-block;
                vertical-align: middle;
                transition: color 0.3s ease;
            `;
            statusText.textContent = '';
            container.appendChild(statusText);

            // Button Container
            const buttonContainer = document.createElement("div");
            buttonContainer.style.cssText = "display: inline-flex; gap: 6px; vertical-align: middle;";

            // Reuse existing buttons
            buttonContainer.appendChild(this.state.uiElements.goToButton);
            buttonContainer.appendChild(this.state.uiElements.updateButton);
            container.appendChild(buttonContainer);

            this.state.uiElements.container = container;
            this.state.uiElements.statusText = statusText;
            return container;
        }

        _createButton(text, bgColor, onClick) {
            const button = document.createElement("button");
            button.textContent = text;
            button.style.cssText = `
                background-color: ${bgColor};
                color: #fff;
                border: none;
                border-radius: 18px;
                padding: 7px 14px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                transition: background-color 0.2s ease, opacity 0.2s ease, filter 0.2s ease;
                white-space: nowrap;
                vertical-align: middle; /* Align button vertically */
            `;
            button.addEventListener("click", onClick);
            button.onmouseover = () => { if (!button.disabled) button.style.filter = 'brightness(0.9)'; };
            button.onmouseout = () => button.style.filter = 'brightness(1)';
            button.setAttribute('role', 'button');
            return button;
        }

        updateUI() {
            if (!this.state.uiElements?.statusText) return;
            const { statusText, goToButton, updateButton } = this.state.uiElements;

            // Status text update handled by setStatus directly

            // Button states
            const isDisabled = this.state.isSearching;
            goToButton.disabled = isDisabled || this.state.lastVideos.length === 0;
            updateButton.disabled = isDisabled;

            goToButton.style.opacity = goToButton.disabled ? '0.6' : '1';
            goToButton.style.cursor = goToButton.disabled ? 'not-allowed' : 'pointer';
            goToButton.style.filter = goToButton.disabled ? 'grayscale(60%)' : 'brightness(1)';

            updateButton.style.opacity = updateButton.disabled ? '0.6' : '1';
            updateButton.style.cursor = updateButton.disabled ? 'not-allowed' : 'pointer';
            updateButton.style.filter = updateButton.disabled ? 'grayscale(60%)' : 'brightness(1)';
        }

        // --- MODIFIED setStatus ---
        setStatus(message, color = STATUS_COLORS.SUCCESS) { // Default color to SUCCESS for relevant messages
            if (!this.state.uiElements?.statusText) return;

            // Always clear previous timeout if setting new status
            if (this.state.statusTimeout) {
                clearTimeout(this.state.statusTimeout);
                this.state.statusTimeout = null;
            }

            // Only display text for specific messages
            if (message === UI_TEXT.STATUS_UPDATED || message === UI_TEXT.STATUS_FOUND) {
                this.state.uiElements.statusText.textContent = message;
                this.state.uiElements.statusText.style.color = color;
                // Don't automatically clear here, let caller decide (using _clearStatusAfterDelay)
            } else {
                // Clear text for all other statuses (Idle, Searching, Error, etc.)
                this.state.uiElements.statusText.textContent = '';
                // We could optionally change container style/color here if needed based on 'color'
                // Example: this.state.uiElements.container.style.borderColor = color;
            }
            // No need to call updateUI() here just for status text
        }

        // Helper to clear status after delay
        _clearStatusAfterDelay() {
            if (this.state.statusTimeout) { // Clear existing timeout if any
                clearTimeout(this.state.statusTimeout);
            }
            this.state.statusTimeout = setTimeout(() => {
                if (this.state.uiElements?.statusText) {
                    this.state.uiElements.statusText.textContent = '';
                }
                this.state.statusTimeout = null;
            }, this.config.STATUS_MESSAGE_DURATION);
        }

        // --- Storage (_saveData, _loadData) ---
        _saveData(key, data) { try { GM_setValue(key, JSON.stringify(data)); } catch (e) { console.error('YT ST: Save GM Error', e); try { localStorage.setItem(key, JSON.stringify(data)); } catch (e2) { console.error('YT ST: Save LS Error', e2); } } }
        _loadData(key, defaultValue) { try { let v = GM_getValue(key); if (v !== undefined && v !== null) { if (v.trim() !== '') return JSON.parse(v); } } catch (e) { console.error('YT ST: Load GM Error', e, "Val:", GM_getValue(key)); } try { let v = localStorage.getItem(key); if (v !== undefined && v !== null) { if (v.trim() !== '') return JSON.parse(v); } } catch (e2) { console.error('YT ST: Load LS Error', e2, "Val:", localStorage.getItem(key)); } return defaultValue; }

        // --- Observation & Helpers (setupObserver, _handlePageChange, _wait) ---
        setupObserver() {
            const targetNode = document.querySelector('ytd-page-manager') || document.body;
            const observer = new MutationObserver(this.debouncedHandlePageChange);
            observer.observe(targetNode, { childList: true, subtree: true });
            console.log("YT Sub Tracker: Observer set up on", targetNode);
        }

        _handlePageChange(mutationsList) {
            // Remove the UI if we're on a video watch page
            if (window.location.href.includes('/watch?v=')) {
                const uiElement = document.getElementById(SELECTORS.UI_CONTAINER_ID);
                if (uiElement && document.body.contains(uiElement)) {
                    uiElement.remove();
                }
                return;
            }

            const uiElement = document.getElementById(SELECTORS.UI_CONTAINER_ID);
            if (!uiElement || !document.body.contains(uiElement)) {
                console.log("YT ST: UI panel re-init.");
                if (this.state.isSearching) {
                    this.state.isSearching = false;
                    this.setStatus('');
                }
                this.initializeUI();
            } else {
                this.updateUI();
            }
        }

        _wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

        // Add helper method to compare arrays
        _areArraysEqual(arr1, arr2) {
            if (arr1.length !== arr2.length) return false;
            return arr1.every((item, index) => item === arr2[index]);
        }

    }

    // --- Initialization ---
    console.log("YT Sub Tracker Script Loaded");
    const tracker = new YouTubeTracker();
    // window.ytTracker = tracker; // Optional for debugging

})();