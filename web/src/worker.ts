/// <reference lib="webworker" />
// @ts-ignore - wasm asset url + loader
import loadHighs from 'highs';
// @ts-ignore
import wasmUrl from 'highs/runtime?url';
import { runPipeline, type RunInput } from './engine/pipeline';

let highsP: Promise<any> | null = null;
const getHighs = () => (highsP ??= loadHighs({ locateFile: () => wasmUrl }));

self.onmessage = async (e: MessageEvent<RunInput>) => {
  try {
    self.postMessage({ type: 'progress', msg: 'Loading solver…' });
    const highs = await getHighs();
    const result = runPipeline(e.data, highs, (msg) => self.postMessage({ type: 'progress', msg }));
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', msg: (err as Error).message ?? String(err) });
  }
};
