import { render } from 'preact';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './styles.css';
import { App } from './App';
import { Runtime } from './app/runtime';

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');

const runtime = new Runtime();
// Debug handle for automated browser tests (read-mostly; not used by the UI).
(window as unknown as { __kmRuntime: Runtime }).__kmRuntime = runtime;
render(<App runtime={runtime} />, root);
runtime.start();
