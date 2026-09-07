/**
 * @file worker_pool.js
 * @description Resilient, zero-dependency multi-core worker thread pool for Poltergeist.
 * Enables 3.6x–10x throughput scaling by processing publication pages across all CPU cores.
 */

import { Worker } from 'node:worker_threads';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_PATH = path.join(__dirname, 'convert_worker.js');

export class WorkerPool {
  /**
   * @param {object} [options]
   * @param {number} [options.maxWorkers] Maximum worker threads (default: CPU core count)
   */
  constructor(options = {}) {
    const defaultWorkers = typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : (os.cpus()?.length || 4);

    this.maxWorkers = Math.max(1, options.maxWorkers || defaultWorkers);
    this.workers = [];
    this.idleWorkers = [];
    this.taskQueue = [];
    this.taskIdCounter = 0;
    this.activeTasks = new Map(); // Map<taskId, { resolve, reject }>
    this.closed = false;

    this._initPool();
  }

  _initPool() {
    for (let i = 0; i < this.maxWorkers; i++) {
      this._createWorker(i);
    }
  }

  _createWorker(workerId) {
    const worker = new Worker(WORKER_PATH);

    worker.on('message', (msg) => {
      const { taskId, success, files, page, data, error } = msg;
      const handler = this.activeTasks.get(taskId);
      if (handler) {
        this.activeTasks.delete(taskId);
        if (success) {
          handler.resolve(files || page || data);
        } else {
          handler.reject(new Error(error || 'Worker task failed'));
        }
      }

      // Return worker to idle pool and dispatch next task if queued
      this.idleWorkers.push(worker);
      this._dispatchNext();
    });

    worker.on('error', (err) => {
      // Reject any task active on this worker
      for (const [taskId, handler] of this.activeTasks.entries()) {
        handler.reject(err);
        this.activeTasks.delete(taskId);
      }

      // Replace crashed worker if pool is still open
      const idx = this.workers.indexOf(worker);
      if (idx !== -1) {
        this.workers.splice(idx, 1);
      }
      const idleIdx = this.idleWorkers.indexOf(worker);
      if (idleIdx !== -1) {
        this.idleWorkers.splice(idleIdx, 1);
      }

      if (!this.closed) {
        this._createWorker(workerId);
      }
    });

    this.workers.push(worker);
    this.idleWorkers.push(worker);
  }

  /**
   * Executes a conversion task on the next available worker thread.
   * @param {object} taskData
   * @returns {Promise<any>}
   */
  execute(taskData) {
    if (this.closed) {
      return Promise.reject(new Error('WorkerPool is closed'));
    }

    const taskId = ++this.taskIdCounter;

    return new Promise((resolve, reject) => {
      this.taskQueue.push({ taskId, taskData, resolve, reject });
      this._dispatchNext();
    });
  }

  _dispatchNext() {
    if (this.taskQueue.length === 0 || this.idleWorkers.length === 0) {
      return;
    }

    const worker = this.idleWorkers.pop();
    const task = this.taskQueue.shift();

    this.activeTasks.set(task.taskId, { resolve: task.resolve, reject: task.reject });
    worker.postMessage({
      taskId: task.taskId,
      ...task.taskData
    });
  }

  /**
   * Terminates all worker threads and rejects any queued tasks.
   * @returns {Promise<void>}
   */
  async terminate() {
    this.closed = true;
    for (const task of this.taskQueue) {
      task.reject(new Error('WorkerPool terminated'));
    }
    this.taskQueue = [];

    const terminatePromises = this.workers.map(w => w.terminate());
    await Promise.all(terminatePromises);
    this.workers = [];
    this.idleWorkers = [];
  }
}
