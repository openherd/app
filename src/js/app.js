import { openherd } from './openherd.js';
import { discovery } from './discovery.js';
import { Geolocation } from '@capacitor/geolocation';

class OpenHerdApp {
  constructor() {
    this.posts = [];
    this.loading = false;
    this.currentLocation = null;
    this.currentTab = 'feed';

    this.init();
  }

  async init() {
    await this.loadPosts();
    this.setupEventListeners();
    this.startAutoRefresh();
    this.setupOnlineStatusMonitoring();


    if (openherd.settings.autoDiscovery) {
      discovery.startPeriodicDiscovery();
      discovery.addListener((cows) => {
        openherd.discoveredCows = cows.map(c => c.url);
        this.updateDiscoveredCowsList();
      });
    }


    this.getCurrentLocation();
    this.syncPendingPosts();
    this.showApp();
  }

  showApp() {

    const loadingScreen = document.getElementById('app-loading-screen');
    if (loadingScreen) {
      loadingScreen.classList.add('hidden');
      setTimeout(() => {
        loadingScreen.style.display = 'none';
      }, 300);
    }


    const app = document.querySelector('ion-app');
    if (app) {
      app.classList.add('loaded');
    }
  }

  setupOnlineStatusMonitoring() {
    window.addEventListener('online', () => {
      this.showInfo('Connection restored!');
      this.syncPendingPosts();
      this.loadPosts();
    });

    window.addEventListener('offline', () => {
      this.showInfo('You are offline - posts will be queued for sync');
    });
  }

  async getCurrentLocation() {
    try {
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 300000
      });
      this.currentLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
    } catch (error) {
      console.error('Failed to get location:', error);

      this.currentLocation = {
        latitude: 33.753746,
        longitude: -84.386330
      };
    }
  }

  setupEventListeners() {

    document.getElementById('tab-feed').addEventListener('click', () => {
      this.switchTab('feed');
    });

    document.getElementById('tab-compose').addEventListener('click', () => {
      this.switchTab('compose');
    });

    document.getElementById('tab-settings').addEventListener('click', () => {
      this.switchTab('settings');
    });


    const refresher = document.getElementById('feed-refresher');
    if (refresher) {
      refresher.addEventListener('ionRefresh', async (event) => {
        await this.loadPosts();
        event.target.complete();
      });
    }
    document.getElementById('submit-post').addEventListener('click', () => {
      this.submitPost();
    });
    document.getElementById('save-settings').addEventListener('click', () => {
      this.saveSettings();
    });
    document.getElementById('discover-cows').addEventListener('click', () => {
      this.discoverCows();
    });


    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => {
        this.syncPendingPosts();
      });
    }
  }

  switchTab(tab) {
    this.currentTab = tab;
    document.getElementById('feed-page').style.display = 'none';
    document.getElementById('compose-page').style.display = 'none';
    document.getElementById('settings-page').style.display = 'none';
    document.getElementById(`${tab}-page`).style.display = 'block';

    document.querySelectorAll('ion-tab-button').forEach(btn => {
      btn.classList.remove('tab-selected');
    });
    document.getElementById(`tab-${tab}`).classList.add('tab-selected');

    if (tab === 'settings') {
      this.loadSettingsUI();
    }
  }

  async loadPosts() {
    if (this.loading) return;

    this.loading = true;

    try {
      let posts = [];


      if (openherd.isOnline()) {

        posts = await openherd.fetchPosts();


        if (openherd.discoveredCows.length > 0) {
          const discoveredPosts = await Promise.all(
            openherd.discoveredCows.map(cow => openherd.fetchPosts(cow))
          );
          posts.push(...discoveredPosts.flat());
        }


        const uniquePosts = Array.from(
          new Map(posts.map(post => [post.id, post])).values()
        );


        if (uniquePosts.length > 0) {
          openherd.saveCachedPosts(uniquePosts);
          this.posts = openherd.sortByDate(uniquePosts);
        } else {
          this.posts = openherd.sortByDate(openherd.cachedPosts);
        }
      } else {
        this.posts = openherd.sortByDate(openherd.cachedPosts);
      }


      if (openherd.pendingPosts.length > 0) {
        const pendingPostsForDisplay = openherd.pendingPosts.map(p => ({
          ...p.envelope,
          parsedData: JSON.parse(p.envelope.data),
          isPending: true
        }));
        this.posts = openherd.sortByDate([...pendingPostsForDisplay, ...this.posts]);
      }

      this.renderPosts();
      this.updateSyncStatus();
    } catch (error) {
      console.error('Failed to load posts:', error);

      this.posts = openherd.sortByDate(openherd.cachedPosts);
      this.renderPosts();
      this.showError('Failed to load posts. Showing cached content.');
    } finally {
      this.loading = false;
    }
  }

  renderPosts() {
    const container = document.getElementById('posts-container');

    if (this.posts.length === 0) {
      container.innerHTML = `
        <ion-card>
          <ion-card-content>
            <p style="text-align: center;">
              No posts yet. Be the first to moo! 🐄
            </p>
          </ion-card-content>
        </ion-card>
      `;
      return;
    }

    const rootPosts = openherd.getRootPosts(this.posts);

    container.innerHTML = rootPosts.map(post => this.renderPost(post)).join('');
  }

  renderPost(post) {
    const data = post.parsedData;
    const date = new Date(data.date);
    const timeAgo = this.getTimeAgo(date);
    const replies = openherd.getReplies(data.id, this.posts);

    const shortId = data.id.substring(0, 8);

    let locationDisplay;
    if (this.currentLocation) {
      const distance = openherd.calculateDistance(
        this.currentLocation.latitude,
        this.currentLocation.longitude,
        data.latitude,
        data.longitude
      );
      locationDisplay = openherd.formatDistance(distance);
    } else {
      locationDisplay = `~${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`;
    }

    return `
      <ion-card${post.isPending ? ' style="border-left: 4px solid var(--ion-color-warning);"' : ''}>
        <ion-card-header>
          <ion-card-subtitle>
            <span class="material-symbols-outlined">account_circle</span>
            ${shortId} &bull; ${timeAgo}
            ${post.isPending ? ' <ion-badge color="warning">Pending Sync</ion-badge>' : ''}
          </ion-card-subtitle>
        </ion-card-header>
        <ion-card-content>
          <p>${this.escapeHtml(data.text)}</p>
          ${replies.length > 0 ? `
            <ion-badge color="primary">${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}</ion-badge>
          ` : ''}
          <div style="margin-top: 12px; font-size: 0.85em;">
            <span class="material-symbols-outlined">location_on</span>
            ${locationDisplay}
          </div>
        </ion-card-content>
      </ion-card>
    `;
  }

  getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }


  async showToast(message, color = 'danger', duration = 2000) {
    const toast = document.createElement('ion-toast');
    toast.message = message;
    toast.duration = duration;
    toast.color = color;
    toast.position = 'bottom';

    document.body.appendChild(toast);
    await toast.present();


    toast.addEventListener('didDismiss', () => {
      toast.remove();
    });
  }

  showError(message) {
    this.showToast(message, 'danger');
  }

  showSuccess(message) {
    this.showToast(message, 'success');
  }

  showInfo(message) {
    this.showToast(message, 'primary', 3000);
  }

  async submitPost() {
    const text = document.getElementById('post-text').value.trim();

    if (!text) {
      this.showError('Please enter some text');
      return;
    }

    if (!this.currentLocation) {
      this.showInfo('Getting your location...');
      await this.getCurrentLocation();
      if (!this.currentLocation) {
        this.showError('Could not get location');
        return;
      }
    }

    try {
      this.showInfo('Creating and signing your post...');

      const envelope = await openherd.createPost(
        text,
        this.currentLocation.latitude,
        this.currentLocation.longitude
      );

      this.showInfo('Broadcasting to the herd...');
      const success = await openherd.broadcastPost(envelope, true);

      if (success > 0) {
        this.showSuccess(`Posted to ${success} Cow${success > 1 ? 's' : ''}! 🐄`);
        document.getElementById('post-text').value = '';
        this.switchTab('feed');
        await this.loadPosts();
      } else if (!openherd.isOnline()) {
        this.showInfo('Post saved offline. Will sync when online! 🐄');
        document.getElementById('post-text').value = '';
        this.switchTab('feed');
        await this.loadPosts();
      } else {
        this.showInfo('Post queued for sync. Will retry later! 🐄');
        document.getElementById('post-text').value = '';
        this.switchTab('feed');
        await this.loadPosts();
      }
    } catch (error) {
      console.error('Post submission error:', error);
      this.showError('Failed to create post: ' + error.message);
    }
  }

  loadSettingsUI() {
    document.getElementById('default-cow').value = openherd.settings.defaultCow;
    document.getElementById('skew-mode').value = openherd.settings.skewMode;
    document.getElementById('auto-discovery').checked = openherd.settings.autoDiscovery;
    document.getElementById('distance-unit').value = openherd.settings.distanceUnit;
    this.updateDiscoveredCowsList();
  }

  saveSettings() {
    openherd.settings.defaultCow = document.getElementById('default-cow').value;
    openherd.settings.skewMode = document.getElementById('skew-mode').value;
    openherd.settings.autoDiscovery = document.getElementById('auto-discovery').checked;
    openherd.settings.distanceUnit = document.getElementById('distance-unit').value;

    openherd.saveSettings();

    if (openherd.settings.autoDiscovery) {
      discovery.startPeriodicDiscovery();
    } else {
      discovery.stopPeriodicDiscovery();
    }

    this.showSuccess('Settings saved! 🐄');
    this.switchTab('feed');
    this.loadPosts();
  }

  async discoverCows() {
    this.showInfo('Scanning for local Cows...');
    try {
      const cows = await discovery.discover();
      this.updateDiscoveredCowsList();

      if (cows.length === 0) {
        this.showInfo('No local Cows found on your network');
      } else {
        this.showSuccess(`Found ${cows.length} Cow${cows.length > 1 ? 's' : ''} nearby! 🐄`);
      }
    } catch (error) {
      console.error('Discovery failed:', error);
      this.showError('Discovery failed: ' + error.message);
    }
  }

  updateDiscoveredCowsList() {
    const container = document.getElementById('discovered-cows-list');
    const cows = discovery.getDiscoveredCows();

    if (cows.length === 0) {
      container.innerHTML = '<ion-note>No local Cows discovered yet</ion-note>';
      return;
    }

    container.innerHTML = cows.map(cow => `
      <ion-item>
        <span class="material-symbols-outlined" slot="start">dns</span>
        <ion-label>
          <h3>${cow.name}</h3>
          <p>${cow.url}</p>
        </ion-label>
      </ion-item>
    `).join('');
  }

  startAutoRefresh() {
    setInterval(() => {
      if (this.currentTab === 'feed') {
        this.loadPosts();
      }
    }, 30000);
  }

  async syncPendingPosts() {
    if (openherd.pendingPosts.length === 0) {
      return;
    }

    this.showInfo('Syncing pending posts...');

    try {
      const result = await openherd.syncPendingPosts();

      if (result.success > 0) {
        this.showSuccess(`Synced ${result.success} post${result.success > 1 ? 's' : ''}! 🐄`);
      }

      if (result.failed > 0) {
        this.showInfo(`${result.failed} post${result.failed > 1 ? 's' : ''} still pending`);
      }

      await this.loadPosts();
    } catch (error) {
      console.error('Sync failed:', error);
      this.showError('Sync failed: ' + error.message);
    }
  }

  updateSyncStatus() {
    const syncBtn = document.getElementById('sync-btn');
    if (!syncBtn) return;

    const pendingCount = openherd.pendingPosts.length;

    if (pendingCount > 0) {
      syncBtn.style.display = 'block';
      const badge = syncBtn.querySelector('ion-badge');
      if (badge) {
        badge.textContent = pendingCount;
      }
    } else {
      syncBtn.style.display = 'none';
    }
  }
}


document.addEventListener('DOMContentLoaded', () => {
  window.app = new OpenHerdApp();
});
