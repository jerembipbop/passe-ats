import crypto from "node:crypto";

// Empreinte stable d'un ensemble de valeurs, pour reconnaître une demande déjà traitée.
export const fingerprint = (...parts) => crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");

// Cache en mémoire limité aux dernières entrées. Il peut contenir des promesses en cours :
// deux demandes identiques et simultanées partagent alors le même appel à l'IA.
export class MemoryCache {
  constructor(max = 50) {
    this.max = max;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  delete(key) {
    this.map.delete(key);
  }
}
