import { mDNS } from '@devioarts/capacitor-mdns';
import { Capacitor } from '@capacitor/core';

export class DiscoveryService {
  constructor() {
    this.discoveredCows = [];
    this.isDiscovering = false;
    this.listeners = [];
  }

  
  async discover() {
    if (!Capacitor.isNativePlatform()) {
      return [];
    }

    try {
      this.isDiscovering = true;      
      const result = await mDNS.discover({
        type: '_openherd._tcp.',
        timeout: 5000
      });



      if (result.error) {
        console.error('Discovery error:', result.errorMessage);
        return [];
      }

      if (!result.services || result.services.length === 0) {
        return [];
      }


      this.discoveredCows = result.services.map(service => {
       
        const host = service.hosts && service.hosts.length > 0 ? service.hosts[0] : service.host;
        const port = service.port || 3000;
        const protocol = 'http';
        
        return {
          name: service.name,
          url: `${protocol}://${host}:${port}`,
          host,
          port,
          txt: service.txt || {}
        };
      });
     
      this.notifyListeners(this.discoveredCows);

      return this.discoveredCows;
    } catch (error) {
      console.error('mDNS discovery failed:', error);
      return [];
    } finally {
      this.isDiscovering = false;
    }
  }

  
  getDiscoveredCows() {
    return this.discoveredCows;
  }

  
  addListener(callback) {
    this.listeners.push(callback);
  }

  
  removeListener(callback) {
    this.listeners = this.listeners.filter(l => l !== callback);
  }

  
  notifyListeners(cows) {
    this.listeners.forEach(listener => listener(cows));
  }

  
  startPeriodicDiscovery(intervalMs = 30000) {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
    }

   
    this.discover();

   
    this.discoveryInterval = setInterval(() => {
      this.discover();
    }, intervalMs);
  }

  
  stopPeriodicDiscovery() {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
  }

  
  async testCow(cowUrl) {
    try {
      const response = await fetch(`${cowUrl}/_openherd/outbox`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });

      return response.ok;
    } catch (error) {
      console.error(`Cow ${cowUrl} unreachable:`, error);
      return false;
    }
  }
}


export const discovery = new DiscoveryService();
