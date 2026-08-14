'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * badgePreload.cjs — the tiny bridge for badge.html.
 *
 * Deliberately separate from the main preload.cjs: the badge window is a
 * different, much smaller surface (no chat, no file access, no vault) and
 * giving it its own minimal bridge means a bug in the 200+ channel main
 * bridge can never affect this one, and vice versa.
 */
contextBridge.exposeInMainWorld('badgeAPI', {
  /** Renderer reports a plain click (not a drag) — main decides what that means. */
  notifyClick: () => ipcRenderer.send('badge:clicked'),

  /** Main pushes status changes — 'live' | 'paused' | 'closed'. */
  onStatus: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('badge:status', handler);
    return () => ipcRenderer.removeListener('badge:status', handler);
  },
});
