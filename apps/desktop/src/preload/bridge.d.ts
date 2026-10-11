import type { CodeoBridge } from '../shared/bridge-types';

declare global {
  interface Window {
    codeo: CodeoBridge;
  }
}
export {};
