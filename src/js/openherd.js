import * as openpgp from 'openpgp';
import { contextSkew } from './skew.js';



export class OpenHerdService {
  constructor() {
    this.defaultCow = 'https://cow.openherd.network';
    this.discoveredCows = [];
    this.loadSettings();
    this.cachedPosts = this.loadCachedPosts();
    this.pendingPosts = this.loadPendingPosts();
  }

  loadSettings() {
    const stored = localStorage.getItem('openherd-settings');
    if (stored) {
      const settings = JSON.parse(stored);
      this.settings = settings;
    } else {
      this.settings = {
        defaultCow: 'https://cow.openherd.network',
        skewMode: 'privacy',
        maintainCity: false,
        maintainPostalCode: false,
        maintainState: false,
        minDistanceKm: null,
        maxDistanceKm: null,
        biasDirection: null,
        autoDiscovery: true,
        distanceUnit: 'metric',
      };
    }
  }

  saveSettings() {
    localStorage.setItem('openherd-settings', JSON.stringify(this.settings));
  }

  
  loadCachedPosts() {
    try {
      const cached = localStorage.getItem('openherd-cached-posts');
      if (cached) {
        const posts = JSON.parse(cached);
        return posts;
      }
    } catch (error) {
      console.error('Failed to load cached posts:', error);
    }
    return [];
  }

  
  saveCachedPosts(posts) {
    try {
     
      const postsToCache = posts.slice(0, 100);
      localStorage.setItem('openherd-cached-posts', JSON.stringify(postsToCache));
      this.cachedPosts = postsToCache;
    } catch (error) {
      console.error('Failed to save cached posts:', error);
    }
  }

  
  loadPendingPosts() {
    try {
      const pending = localStorage.getItem('openherd-pending-posts');
      if (pending) {
        const posts = JSON.parse(pending);
        return posts;
      }
    } catch (error) {
      console.error('Failed to load pending posts:', error);
    }
    return [];
  }

  
  savePendingPosts(posts) {
    try {
      localStorage.setItem('openherd-pending-posts', JSON.stringify(posts));
      this.pendingPosts = posts;
    } catch (error) {
      console.error('Failed to save pending posts:', error);
    }
  }

  
  addPendingPost(envelope) {
    this.pendingPosts.push({
      envelope,
      timestamp: Date.now(),
      attempts: 0
    });
    this.savePendingPosts(this.pendingPosts);
  }

  
  isOnline() {
    return navigator.onLine;
  }

  
  async generateKeypair(name = 'Anonymous') {
    const { privateKey, publicKey } = await openpgp.generateKey({
      type: 'rsa',
      rsaBits: 2048,
      userIDs: [{ name }],
      format: 'armored'
    });

    return { privateKey, publicKey };
  }
  async getKeyId(publicKeyArmored) {
    const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
    return publicKey.getFingerprint();
  }
  
  async signData(data, privateKeyArmored) {
    const privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
    
    const message = await openpgp.createMessage({ text: data });
    const signature = await openpgp.sign({
      message,
      signingKeys: privateKey,
      detached: true
    });

    return signature;
  }

  
  async verifyPost(envelope) {
    try {
      const publicKey = await openpgp.readKey({ armoredKey: envelope.publicKey });
      const message = await openpgp.createMessage({ text: envelope.data });
      const signature = await openpgp.readSignature({ armoredSignature: envelope.signature });

      const verificationResult = await openpgp.verify({
        message,
        signature,
        verificationKeys: publicKey
      });

      const { verified } = verificationResult.signatures[0];
      await verified;
      
      return true;
    } catch (error) {
      console.error('Signature verification failed:', error);
      return false;
    }
  }

  
  async createPost(text, latitude, longitude, parent = null) {
   
    const { privateKey, publicKey } = await this.generateKeypair();
    const keyId = await this.getKeyId(publicKey);

   
    const fuzzed = contextSkew(
      latitude,
      longitude,
      { population: 1000, place: 'village', nearbyHouseCount: 10 },
      {
        mode: this.settings.skewMode,
        maintainCity: this.settings.maintainCity,
        maintainPostalCode: this.settings.maintainPostalCode,
        maintainState: this.settings.maintainState,
        minDistanceKm: this.settings.minDistanceKm,
        maxDistanceKm: this.settings.maxDistanceKm,
        biasDirection: this.settings.biasDirection
      }
    );

   
    const data = {
      id: keyId,
      text,
      latitude: fuzzed.latitude,
      longitude: fuzzed.longitude,
      date: new Date().toISOString(),
      parent: parent
    };

    const dataString = JSON.stringify(data);

   
    const signature = await this.signData(dataString, privateKey);

   
    const envelope = {
      signature,
      publicKey,
      id: keyId,
      data: dataString
    };

    return envelope;
  }

  
  async fetchPosts(cowUrl = null) {
    const url = cowUrl || this.settings.defaultCow;
    try {
      const response = await fetch(`${url}/_openherd/outbox`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const posts = await response.json();
      
     
      return posts.map(post => ({
        ...post,
        parsedData: JSON.parse(post.data)
      }));
    } catch (error) {
      console.error('Failed to fetch posts:', error);
     
      return [];
    }
  }

  
  async submitPost(envelope, cowUrl = null) {
    const url = cowUrl || this.settings.defaultCow;
    try {
      const response = await fetch(`${url}/_openherd/inbox`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([envelope]),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return result.ok;
    } catch (error) {
      console.error('Failed to submit post:', error);
      return false;
    }
  }

  
  async broadcastPost(envelope, saveAsPending = false) {
    if (!this.isOnline()) {
      if (saveAsPending) {
        this.addPendingPost(envelope);
      }
      return 0;
    }

    const cows = [this.settings.defaultCow, ...this.discoveredCows];
    const results = await Promise.allSettled(
      cows.map(cow => this.submitPost(envelope, cow))
    );
    
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
    
   
    if (successCount === 0 && saveAsPending) {
     
      this.addPendingPost(envelope);
    }
    
    return successCount;
  }

  
  async syncPendingPosts() {
    if (this.pendingPosts.length === 0) {
      return { success: 0, failed: 0 };
    }

    if (!this.isOnline()) {
      return { success: 0, failed: this.pendingPosts.length };
    }

    
    const results = [];
    const failedPosts = [];

    for (const pending of this.pendingPosts) {
      pending.attempts++;
      const success = await this.broadcastPost(pending.envelope, false);
      
      if (success > 0) {
        results.push({ success: true, count: success });
      } else {
       
        if (pending.attempts < 5) {
          failedPosts.push(pending);
        }
        results.push({ success: false });
      }
    }

   
    this.pendingPosts = failedPosts;
    this.savePendingPosts(this.pendingPosts);

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    
    return { success: successCount, failed: failedCount };
  }

  
  async getReplies(postId, posts) {
    return posts.filter(post => post.parsedData.parent === postId);
  }

  
  sortByDate(posts) {
    return posts.sort((a, b) => {
      const dateA = new Date(a.parsedData.date);
      const dateB = new Date(b.parsedData.date);
      return dateB - dateA;
    });
  }

  
  getRootPosts(posts) {
    return posts.filter(post => !post.parsedData.parent || post.parsedData.parent === null);
  }

  
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = R * c;
    
    return distanceKm;
  }

  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  
  formatDistance(distanceKm) {
    if (this.settings.distanceUnit === 'imperial') {
      const miles = distanceKm * 0.621371;
      if (miles < 0.1) {
        return `${Math.round(miles * 5280)} ft away`;
      }
      return `${miles.toFixed(1)} mi away`;
    } else {
      if (distanceKm < 1) {
        return `${Math.round(distanceKm * 1000)} m away`;
      }
      return `${distanceKm.toFixed(1)} km away`;
    }
  }
}


export const openherd = new OpenHerdService();
