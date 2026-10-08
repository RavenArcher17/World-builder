import './style.css';
import { App } from './ui/app';

declare global {
  interface Window {
    worldBuilder?: App;
  }
}

window.worldBuilder = new App();
