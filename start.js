#!/usr/bin/env node
// start.js — loads .env then runs server
import { readFileSync, existsSync } from 'fs';

// Load .env manually (no external dependency)
if (existsSync('.env')) {
  const lines = readFileSync('.env', 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...vals] = trimmed.split('=');
    if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
  }
}

await import('./server.js');
