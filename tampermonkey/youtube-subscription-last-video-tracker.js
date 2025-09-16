// ==UserScript==
// @name         Youtube Subscription Last Video Tracker
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Helps you track and locate the last video(s) you marked on your YouTube Subscriptions page.
// @author       volkan.cicek
// @match        https://www.youtube.com/feed/subscriptions*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

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

  function areArraysEqual(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    return arr1.every((item, index) => item === arr2[index]);
  }

  // --- Configuration ---
  const DEFAULT_CONFIG = {
    MAX_STORED_VIDEOS: 10,
    STORAGE_KEY: "yt_sub_tracker_last_marked",
    SCROLL_OFFSET: 150,
    HIGHLIGHT_DURATION: 5000,
    HIGHLIGHT_COLOR: "rgba(255, 215, 0, 0.4)",
    DEBOUNCE_DELAY: 300,
    MAX_SCROLL_ATTEMPTS: 15,
    // Filter keywords for excluding live/streamed content
    // include Turkish and English variants that indicate a live stream or live viewers
    LIVE_STREAM_KEYWORDS: ["yayınlandı", "canlı", "streamed", "izliyor", "watching", "live"],
    // Filter keywords for excluding upcoming/scheduled content
    UPCOMING_KEYWORDS: ["tarihinde yayında", "yakında", "scheduled", "premiere", "planlandı", "planlanıyor"],
  };

  // --- Constants ---
  const SELECTORS = {
    VIDEO_ITEM: "ytd-rich-item-renderer, ytd-grid-video-renderer",
    VIDEO_LINK: "a#video-title-link",
    VIDEO_THUMBNAIL_LINK: "a#thumbnail",
    VIDEO_TITLE: "#video-title",
    // Generic watch link selector (more resilient to YouTube DOM changes)
    WATCH_LINK: 'a[href*="/watch?v="]',
    VIDEO_META_BLOCK: "ytd-video-meta-block",
    CHANNEL_NAME: "#channel-name a, ytd-channel-name a",
    ORIGINAL_SECTION_TARGET:
      "#primary ytd-section-list-renderer, #primary ytd-rich-grid-renderer, #dismissible.style-scope.ytd-shelf-renderer",
    ORIGINAL_FALLBACK_PARENT: "ytd-page-manager",
    SHORTS_VIDEO: '[overlay-style="SHORTS"]',
    LIVE_BADGE: ".badge-style-type-live-now",
    UPCOMING_BADGE: ".badge-style-type-live-now-alternate",
    UPCOMING_OVERLAY: '[overlay-style="UPCOMING"]',
    CONTINUATION_ITEM: "ytd-continuation-item-renderer",
    SPINNER: "#spinnerContainer.active, #spinner.ytd-feed-filter-chip-bar-renderer",
    UI_CONTAINER_ID: "yt-sub-tracker-ui",
    RECENT_UPLOADS_SECTION: "#dismissible.style-scope.ytd-shelf-renderer",
    RECENT_UPLOADS_HEADER: "#title-container",
  };

  // --- Simplified UI Text ---
  const UI_TEXT = {
    GO_TO_LAST_BUTTON: "Go to Last Marked",
    UPDATE_LIST_BUTTON: "Update Marker",
    STATUS_UPDATED: "Updated!",
    STATUS_FOUND: "Found!",
  };

  // Status colors
  const STATUS_COLORS = {
    SUCCESS: "#90ee90",
  };

  // --- YouTube Tracker Class ---
  class YouTubeTracker {
    constructor(config) {
      this.config = {
        ...DEFAULT_CONFIG,
        ...config,
      };
      this.state = {
        isSearching: false,
        markedVideos: [],
        hasUnsavedChanges: false,
        uiElements: {
          container: null,
          statusText: null,
          goToButton: this._createButton(
            UI_TEXT.GO_TO_LAST_BUTTON,
            "#f00",
            debounce(this.findAndGoToLastMarked.bind(this), this.config.DEBOUNCE_DELAY)
          ),
          updateButton: this._createButton(
            UI_TEXT.UPDATE_LIST_BUTTON,
            "#3ea6ff",
            debounce(this.updateMarkerList.bind(this), this.config.DEBOUNCE_DELAY)
          ),
        },
        scrollAttempts: 0,
        statusTimeout: null,
      };
      // Cache for frequently accessed DOM elements
      this.domCache = {
        lastCacheTime: 0,
        cacheValidDuration: 60000, // 60 seconds - much longer since page content doesn't change without refresh
        cachedElements: new Map(), // Cache for specific selectors

        lastPageUrl: window.location.href, // Track page URL changes
      };
      this.debouncedHandlePageChange = debounce(this._handlePageChange.bind(this), this.config.DEBOUNCE_DELAY * 5); // Much longer debounce
      this.state.markedVideos = this._loadData(this.config.STORAGE_KEY, []);
      console.log("YT Sub Tracker (Minimal UI): Initialized. Loaded markers:", this.state.markedVideos);

      // Add event listeners for tab closing/switching (guarded)
      try {
        // Some embed/sandboxed contexts forbid unload; wrap in try/catch
        if (typeof window.addEventListener === "function") {
          window.addEventListener("beforeunload", this._handlePageUnload.bind(this));
        }
      } catch (e) {
        console.warn("YT Sub Tracker: beforeunload listener not allowed in this context", e);
      }
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          this._handlePageUnload(); // Call without event for visibilitychange
        }
      });

      // Start initialization process
      this._startInitialization();
    }

    // Handle page closing/tab switching - unified method
    _handlePageUnload(event) {
      if (this.state.hasUnsavedChanges) {
        const message = "Remember to save your last marked position before leaving!";

        // For beforeunload event, show browser warning AND mark that it was shown
        if (event && event.type === "beforeunload") {
          // Mark that beforeunload dialog was shown to prevent duplicate warning
          sessionStorage.setItem("yt_sub_tracker_beforeunload_shown", "true");
          event.preventDefault();
          event.returnValue = message;
          return event.returnValue;
        }

        // For visibility change, only store warning if beforeunload wasn't already shown
        if (!event || event.type === "visibilitychange") {
          const beforeunloadShown = sessionStorage.getItem("yt_sub_tracker_beforeunload_shown");
          if (!beforeunloadShown) {
            const warningData = {
              url: window.location.href,
              timestamp: Date.now(),
              message: message,
            };
            localStorage.setItem("yt_sub_tracker_warning", JSON.stringify(warningData));
          }
        }
      }
    }

    // Update marker list to clear warning data
    async updateMarkerList() {
      if (this.state.isSearching) return;
      this.setStatus(""); // Clear previous status

      // Indicate activity by disabling button immediately
      this.state.uiElements?.updateButton?.setAttribute("disabled", "true");
      this.state.uiElements?.goToButton?.setAttribute("disabled", "true"); // Disable both during update
      await this._wait(50); // Short delay to allow UI redraw

      const visibleVideos = this.findVisibleVideos();

      if (visibleVideos.length === 0) {
        console.warn("YT Sub Tracker: No videos found on screen to set marker.");
        // No visual feedback needed as per requirement
      } else {
        const videosToStore = visibleVideos.slice(0, this.config.MAX_STORED_VIDEOS).map((v) => ({
          id: v.id,
          title: v.title,
          channel: v.channel,
          timestamp: Date.now(),
        }));

        this.state.markedVideos = videosToStore;
        this._saveData(this.config.STORAGE_KEY, this.state.markedVideos);
        this.state.hasUnsavedChanges = false; // Reset unsaved changes flag
        // Clear any existing warning data
        localStorage.removeItem("yt_sub_tracker_warning");
        this.setStatus(UI_TEXT.STATUS_UPDATED, STATUS_COLORS.SUCCESS); // Show temporary message
        console.log("YT Sub Tracker: Updated marker with videos:", this.state.markedVideos);
      }

      // Re-enable buttons and potentially clear message after delay
      await this._wait(50); // Wait briefly before re-enabling
      this.state.uiElements?.updateButton?.removeAttribute("disabled");
      this.state.uiElements?.goToButton?.removeAttribute("disabled");
      this.updateUI(); // Update button states (GoTo might now be enabled)

      // Clear the "Updated" message after a duration
      if (this.state.uiElements?.statusText.textContent === UI_TEXT.STATUS_UPDATED) {
        this._clearStatusAfterDelay();
      }
    }

    // Add method to check for warning on page load
    _checkForWarning() {
      try {
        // Clear the beforeunload flag on page load
        sessionStorage.removeItem("yt_sub_tracker_beforeunload_shown");

        const warningData = localStorage.getItem("yt_sub_tracker_warning");
        if (warningData) {
          const data = JSON.parse(warningData);
          // Only show warning if it's from the same URL and within last 5 minutes
          if (data.url === window.location.href && Date.now() - data.timestamp < 5 * 60 * 1000) {
            alert(data.message);
            localStorage.removeItem("yt_sub_tracker_warning");
          }
        }
      } catch (e) {
        console.error("YT Sub Tracker: Error checking warning:", e);
      }
    }

    // Modify _startInitialization to check for warning
    _startInitialization() {
      // Check for warning first
      this._checkForWarning();

      // Wait for document to be ready
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          setTimeout(() => this._attemptInitialization(), 1500);
        });
      } else {
        setTimeout(() => this._attemptInitialization(), 1500);
      }
    }

    _attemptInitialization() {
      const isPageReady = this._isPageReadyForUI();

      if (isPageReady) {
        console.log("YT Sub Tracker: Page is ready, initializing UI");
        this.initializeUI();
        this.setupObserver();
      } else {
        // Simple single retry after delay
        setTimeout(() => {
          this.initializeUI();
          this.setupObserver();
        }, 1000);
      }
    }

    // Check if the page is ready for UI placement
    _isPageReadyForUI() {
      // Check if we're on a video watch page - don't show UI there
      if (window.location.href.includes("/watch?v=")) {
        return false;
      }

      // Check for key elements that indicate the page is ready
      const hasRecentUploadsSection = !!this._getCachedElements(SELECTORS.RECENT_UPLOADS_SECTION).length;
      const hasPageSection = !!this._getCachedElements(SELECTORS.ORIGINAL_SECTION_TARGET).length;
      const hasFallbackParent = !!this._getCachedElements(SELECTORS.ORIGINAL_FALLBACK_PARENT).length;

      // Page is ready if any of these elements exist
      return hasRecentUploadsSection || hasPageSection || hasFallbackParent;
    }

    // --- Core Logic ---
    async findAndGoToLastMarked() {
      if (this.state.isSearching) return;
      if (this.state.markedVideos.length === 0) {
        console.warn("YT Sub Tracker: 'Go to Last Marked' clicked, but no marker set.");
        // No visual feedback needed
        return;
      }

      this.state.isSearching = true;
      this.state.scrollAttempts = 0;
      this.setStatus(""); // Clear previous status
      this.state.uiElements?.goToButton?.setAttribute("disabled", "true");
      this.state.uiElements?.updateButton?.setAttribute("disabled", "true");

      // Check if we can find the video in current viewport first (use cached elements)
      console.log("YT Sub Tracker: Starting search - checking current viewport first");

      let found = false;
      try {
        // First, check current viewport with cache
        const currentVideos = this.findVisibleVideos();
        found = this._findTargetVideoInList(currentVideos, "current viewport");

        // If not found in viewport, check all loaded videos first before scrolling
        if (!found) {
          console.log("YT Sub Tracker: Target video not in viewport, checking all loaded videos");

          // Get all videos on page (not just visible ones) - this is much faster than scrolling
          const allLoadedVideos = this._getAllLoadedVideos();
          found = this._findTargetVideoInList(allLoadedVideos, "loaded content");

          // Only start scrolling search if video is not in already loaded content
          if (!found) {
            console.log("YT Sub Tracker: Target video not in loaded content, starting scroll search");
            found = await this._searchLoop();
          }
        }
      } catch (error) {
        console.error("YT Sub Tracker: Error during search:", error);
        // No visual error message needed
      } finally {
        this.state.isSearching = false;

        // Re-enable buttons first
        this.state.uiElements?.goToButton?.removeAttribute("disabled");
        this.state.uiElements?.updateButton?.removeAttribute("disabled");
        this.updateUI(); // Update button states

        // If found, the "Found!" message is already showing. Clear it after delay.
        // If not found, just ensure status is clear.
        if (found) {
          this._clearStatusAfterDelay();
        } else {
          this.setStatus(""); // Ensure status is clear if not found
        }
      }
    }

    async _searchLoop() {
      while (this.state.scrollAttempts < this.config.MAX_SCROLL_ATTEMPTS) {
        const currentVideos = this.findVisibleVideos();

        if (this._findTargetVideoInList(currentVideos)) {
          return true; // Found!
        }

        // Not found on current screen - try to scroll and load more
        const scrolled = await this._scrollAndLoadMore();
        if (!scrolled) {
          console.log("YT Sub Tracker: Cannot scroll further or no more content");
          return false; // End of feed or cannot load more
        }

        this.state.scrollAttempts++;
        await this._wait(500); // Small delay between attempts
      }
      console.log("YT Sub Tracker: Max scroll attempts reached");
      return false; // Max scroll attempts reached
    }

    // --- DOM Caching Methods ---
    _getCachedElements(selector, maxAge = this.domCache.cacheValidDuration) {
      const cacheKey = selector;
      const cached = this.domCache.cachedElements.get(cacheKey);
      const now = Date.now();

      if (cached && now - cached.timestamp < maxAge) {
        return cached.elements;
      }

      const elements = document.querySelectorAll(selector);
      this.domCache.cachedElements.set(cacheKey, {
        elements: elements,
        timestamp: now,
      });

      return elements;
    }

    _invalidateCache() {
      this.domCache.cachedElements.clear();
      this.domCache.lastCacheTime = 0;
      console.log("YT Sub Tracker: Cache cleared");
    }

    // --- DOM Interaction (findVisibleVideos, _getAllLoadedVideos, _scrollToElement, _highlightElement, _canLoadMore, _waitForLoad) ---

    _findTargetVideoInList(videoList, context = "") {
      for (const markedVideo of this.state.markedVideos) {
        const foundVideo = videoList.find((v) => v.id === markedVideo.id);
        if (foundVideo) {
          if (context) {
            console.log(`YT Sub Tracker: Found target video in ${context} - no scrolling needed!`);
          }
          this.setStatus(UI_TEXT.STATUS_FOUND, STATUS_COLORS.SUCCESS);
          this._scrollToElement(foundVideo.element);
          this._highlightElement(foundVideo.element);
          return true;
        }
      }
      return false;
    }

    _getAllLoadedVideos() {
      // More resilient approach: find anchors that link to watch?v= and derive video container
      const videoMap = new Map(); // dedupe by video id
      const anchors = document.querySelectorAll(SELECTORS.WATCH_LINK);

      for (const a of anchors) {
        const href = a.href || a.getAttribute('href') || '';
        const match = href.match(/watch\?v=([^&]+)/);
        if (!match) continue;
        const videoId = match[1];
        if (videoMap.has(videoId)) continue; // already captured

        // Prefer closest known YouTube item containers, fallback to anchor's parent element
        const container = a.closest(
          'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-rich-grid-renderer, ytd-rich-shelf-renderer, ytd-rich-item-renderer, ytd-rich-item-renderer, ytm-shorts-lockup-view-model, ytd-rich-item-renderer'
        ) || a.parentElement;

        if (!container) continue;
        if (this._shouldSkipVideo(container)) continue;

        const data = this._extractVideoDataFromAnchor(a, container);
        if (data) videoMap.set(videoId, data);
      }

      const videoElements = Array.from(videoMap.values()).sort((a, b) => a.position - b.position);
      console.log(`YT Sub Tracker: Found ${videoElements.length} total loaded videos on page`);
      return videoElements;
    }

    findVisibleVideos() {
      // Use the anchor-derived video list but filter by viewport intersection
      const allVideos = this._getAllLoadedVideos();
      const visible = [];

      for (const v of allVideos) {
        const rect = v.element.getBoundingClientRect();
        if (rect.bottom < -200 || rect.top > window.innerHeight + 200) continue;
        visible.push(v);
      }

      visible.sort((a, b) => a.position - b.position);

      if (visible.length > 0) {
        const currentVideoIds = visible.slice(0, this.config.MAX_STORED_VIDEOS).map((v) => v.id);
        const markedVideoIds = this.state.markedVideos.map((v) => v.id);
        this.state.hasUnsavedChanges = !areArraysEqual(currentVideoIds, markedVideoIds);
      }

      return visible;
    }

    _shouldSkipVideo(element) {
      // Skip shorts, live badges, upcoming content, and upcoming overlays
      if (
        element.querySelector(SELECTORS.SHORTS_VIDEO) ||
        element.querySelector(SELECTORS.LIVE_BADGE) ||
        element.querySelector(SELECTORS.UPCOMING_BADGE) ||
        element.querySelector(SELECTORS.UPCOMING_OVERLAY)
      ) {
        return true;
      }

      // Inspect textual badges/overlays and metadata to detect live or upcoming items
      try {
        // 1) Check textual badges inside the element (e.g., 'CANLI', 'LIVE', viewer counts like 'izliyor')
        const badgeTexts = Array.from(element.querySelectorAll('badge-shape, .yt-badge-shape, .badge, .yt-badge')).map(
          (n) => (n.textContent || '').trim().toLowerCase()
        );
        for (const t of badgeTexts) {
          if (!t) continue;
          if (t.includes('canli') || t.includes('live') || t.includes('izliyor') || t.includes('izliyor')) return true;
        }

        // 2) Check overlay-style elements which sometimes contain 'UPCOMING' or localized strings
        const overlayText = (element.querySelector('[overlay-style], .overlay, .badge-text, .yt-badge-shape__text')?.textContent || '').toLowerCase();
        if (overlayText) {
          if (this.config.LIVE_STREAM_KEYWORDS.some((keyword) => overlayText.includes(keyword))) return true;
          if (this.config.UPCOMING_KEYWORDS.some((keyword) => overlayText.includes(keyword))) return true;
        }

        // 3) Skip based on meta text (duration, publish info). Use trimmed lowercase
        const metaBlock = element.querySelector(SELECTORS.VIDEO_META_BLOCK) || element;
        const metaText = (metaBlock.textContent || '').toLowerCase();
        if (this.config.LIVE_STREAM_KEYWORDS.some((keyword) => metaText.includes(keyword))) {
          return true;
        }
        if (this.config.UPCOMING_KEYWORDS.some((keyword) => metaText.includes(keyword))) {
          return true;
        }
      } catch (e) {
        // If any DOM query fails, don't block the whole script; default to not skipping
        console.warn('YT Sub Tracker: Error while checking live/upcoming badges', e);
      }

      return false;
    }

    _extractVideoData(element) {
      // Legacy method - try to extract from anchor inside element
      const a = element.querySelector(SELECTORS.WATCH_LINK);
      if (!a) return null;
      return this._extractVideoDataFromAnchor(a, element);
    }

    _extractVideoDataFromAnchor(anchor, container) {
      const href = anchor.href || anchor.getAttribute('href') || '';
      const match = href.match(/watch\?v=([^&]+)/);
      if (!match) return null;
      const videoId = match[1];

      // Title: prefer anchor text or a nearby title element
      let title = (anchor.textContent || '').trim();
      if (!title) {
        const titleEl = container.querySelector('a[href*="/watch?v="] > yt-formatted-string, #video-title, h3 a, .yt-lockup-metadata-view-model__title');
        title = titleEl ? titleEl.textContent.trim() : 'Unknown Video';
      }

      // Channel: try common channel link patterns
      let channel = 'Unknown Channel';
      const channelEl = container.querySelector('a[href*="/channel/"], a[href*="/@"], ytd-channel-name a, #channel-name a');
      if (channelEl) channel = channelEl.textContent.trim();

      const rect = container.getBoundingClientRect();
      const position = rect.top + window.scrollY;

      return {
        id: videoId,
        title: title,
        channel: channel,
        element: container,
        position: position,
      };
    }

    _scrollToElement(element) {
      const targetY = element.getBoundingClientRect().top + window.scrollY - this.config.SCROLL_OFFSET;
      window.scrollTo({
        top: targetY,
        behavior: "smooth",
      });
    }
    _highlightElement(element) {
      const originalStyle = element.style.cssText;
      element.style.transition =
        "background-color 0.3s ease-in-out, box-shadow 0.3s ease-in-out, border-radius 0.3s ease-in-out";
      element.style.backgroundColor = this.config.HIGHLIGHT_COLOR;
      element.style.boxShadow = `0 0 15px 5px ${this.config.HIGHLIGHT_COLOR}`;
      element.style.borderRadius = "8px";
      setTimeout(() => {
        element.style.cssText = originalStyle;
      }, this.config.HIGHLIGHT_DURATION);
    }

    async _scrollAndLoadMore() {
      // Check if we can load more content
      if (!(await this._canLoadMore())) {
        return false;
      }

      const initialScrollHeight = document.body.scrollHeight;

      // Scroll to bottom and wait for content
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      await this._wait(500); // Fixed delay instead of config
      await this._waitForLoad();

      // Check if new content loaded
      const newContentLoaded = document.body.scrollHeight > initialScrollHeight;
      if (newContentLoaded) {
        this._invalidateCache();
      }

      return newContentLoaded;
    }

    async _canLoadMore() {
      // Check for continuation items or spinners, but also check if we're not at the very bottom
      const hasContinuation = !!this._getCachedElements(SELECTORS.CONTINUATION_ITEM).length;
      const hasSpinner = !!this._getCachedElements(SELECTORS.SPINNER).length;
      const notAtBottom = window.scrollY + window.innerHeight < document.body.scrollHeight - 50;

      return hasContinuation || hasSpinner || notAtBottom;
    }
    async _waitForLoad() {
      // Simple wait for content to load
      let attempts = 0;
      const maxAttempts = 20; // 4 seconds max (20 * 200ms)

      while (attempts < maxAttempts) {
        const hasSpinner = document.querySelectorAll(SELECTORS.SPINNER).length > 0;
        if (!hasSpinner) break;

        await this._wait(200);
        attempts++;
      }

      // Additional wait for stability
      await this._wait(300);
    }

    // --- UI Methods ---
    _insertUIIntoPage(container, titleContainer) {
      titleContainer.insertAdjacentElement("beforeend", container);

      // Override default styles for inline placement
      container.style.cssText += `
                position: static !important;
                margin: 10px 16px 10px 0 !important;
            `;

      const buttonContainer = container.querySelector("div:last-of-type");
      if (buttonContainer) {
        buttonContainer.style.flexDirection = "row";
        buttonContainer.style.justifyContent = "flex-start";
      }

      this.state.uiElements.statusText.style.flexShrink = "1";
      this.state.uiElements.statusText.style.minWidth = "10px";
      this.state.uiElements.statusText.style.textAlign = "left";
    }

    async initializeUI() {
      if (document.getElementById(SELECTORS.UI_CONTAINER_ID)) {
        this.updateUI();
        return;
      }

      const recentUploadsSections = this._getCachedElements(SELECTORS.RECENT_UPLOADS_SECTION);
      const recentUploadsSection = recentUploadsSections.length > 0 ? recentUploadsSections[0] : null;
      const titleContainer = recentUploadsSection?.querySelector(SELECTORS.RECENT_UPLOADS_HEADER);

      if (recentUploadsSection && titleContainer) {
        const container = this.createUI();
        if (!container) return;

        this._insertUIIntoPage(container, titleContainer);
        this.updateUI();
      } else {
        console.warn("YT Sub Tracker: Recent uploads section not found");
      }
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
      statusText.textContent = "";
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
      button.onmouseover = () => {
        if (!button.disabled) button.style.filter = "brightness(0.9)";
      };
      button.onmouseout = () => (button.style.filter = "brightness(1)");
      button.setAttribute("role", "button");
      return button;
    }

    updateUI() {
      if (!this.state.uiElements?.statusText) return;
      const { statusText, goToButton, updateButton } = this.state.uiElements;

      // Status text update handled by setStatus directly

      // Button states
      const isDisabled = this.state.isSearching;
      goToButton.disabled = isDisabled || this.state.markedVideos.length === 0;
      updateButton.disabled = isDisabled;

      goToButton.style.opacity = goToButton.disabled ? "0.6" : "1";
      goToButton.style.cursor = goToButton.disabled ? "not-allowed" : "pointer";
      goToButton.style.filter = goToButton.disabled ? "grayscale(60%)" : "brightness(1)";

      updateButton.style.opacity = updateButton.disabled ? "0.6" : "1";
      updateButton.style.cursor = updateButton.disabled ? "not-allowed" : "pointer";
      updateButton.style.filter = updateButton.disabled ? "grayscale(60%)" : "brightness(1)";
    }

    // --- MODIFIED setStatus ---
    setStatus(message, color = STATUS_COLORS.SUCCESS) {
      // Default color to SUCCESS for relevant messages
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
        this.state.uiElements.statusText.textContent = "";
        // We could optionally change container style/color here if needed based on 'color'
        // Example: this.state.uiElements.container.style.borderColor = color;
      }
      // No need to call updateUI() here just for status text
    }

    // Helper to clear status after delay
    _clearStatusAfterDelay() {
      if (this.state.statusTimeout) {
        // Clear existing timeout if any
        clearTimeout(this.state.statusTimeout);
      }
      this.state.statusTimeout = setTimeout(() => {
        if (this.state.uiElements?.statusText) {
          this.state.uiElements.statusText.textContent = "";
        }
        this.state.statusTimeout = null;
      }, 2000); // Fixed 2 second duration
    }

    // --- Storage (_saveData, _loadData) ---
    _saveData(key, data) {
      try {
        GM_setValue(key, JSON.stringify(data));
      } catch (e) {
        console.error("YT ST: Save GM Error", e);
        try {
          localStorage.setItem(key, JSON.stringify(data));
        } catch (e2) {
          console.error("YT ST: Save LS Error", e2);
        }
      }
    }
    _loadData(key, defaultValue) {
      try {
        let v = GM_getValue(key);
        if (v !== undefined && v !== null) {
          if (v.trim() !== "") return JSON.parse(v);
        }
      } catch (e) {
        console.error("YT ST: Load GM Error", e, "Val:", GM_getValue(key));
      }
      try {
        let v = localStorage.getItem(key);
        if (v !== undefined && v !== null) {
          if (v.trim() !== "") return JSON.parse(v);
        }
      } catch (e2) {
        console.error("YT ST: Load LS Error", e2, "Val:", localStorage.getItem(key));
      }
      return defaultValue;
    }

    // --- Observation & Helpers
    setupObserver() {
      const targetNode = document.querySelector("ytd-page-manager") || document.body;
      const observer = new MutationObserver(this.debouncedHandlePageChange);
      observer.observe(targetNode, {
        childList: true,
        subtree: true,
      });
      console.log("YT Sub Tracker: Observer set up on", targetNode);
    }

    _handlePageChange(mutationsList) {
      // Only invalidate cache for significant page changes
      const currentUrl = window.location.href;
      const urlChanged = this.domCache.lastPageUrl !== currentUrl;

      // Skip invalidation if we're actively searching and URL hasn't changed
      if (this.state.isSearching && !urlChanged) {
        console.log("YT Sub Tracker: Skipping cache invalidation - search in progress, no URL change");
        return;
      }

      // Only invalidate for actual URL changes or major DOM changes
      if (urlChanged) {
        this._invalidateCache();
        this.domCache.lastPageUrl = currentUrl;
        console.log("YT Sub Tracker: Cache invalidated due to URL change");
      } else {
        // Don't invalidate cache for minor DOM mutations during search
        console.log("YT Sub Tracker: Minor page change, keeping cache");
      }

      // Remove the UI if we're on a video watch page
      if (window.location.href.includes("/watch?v=")) {
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
          this.setStatus("");
        }
        this.initializeUI();
      } else {
        this.updateUI();
      }
    }

    _wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
  }

  // --- Initialization ---
  console.log("YT Sub Tracker Script Loaded");
  const tracker = new YouTubeTracker();
  // window.ytTracker = tracker; // Optional for debugging
})();
