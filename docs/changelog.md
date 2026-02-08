---
outline: deep
---

# Changelog

All notable changes to Gemini Scribe are documented here.

<script setup>
import { data } from './changelog.data.mts';

const versions = Object.entries(data);
</script>

<div v-for="[version, note] of versions" :key="version" class="changelog-entry">

<h2 :id="version">{{ note.title }} <span class="version-badge">v{{ version }}</span></h2>

<ul>
  <li v-for="highlight of note.highlights" :key="highlight">{{ highlight }}</li>
</ul>

<p v-if="note.details" class="details">{{ note.details }}</p>

<hr />

</div>

<style>
.changelog-entry {
  margin-bottom: 1rem;
}
.version-badge {
  font-size: 0.75em;
  font-weight: 500;
  padding: 0.15em 0.5em;
  border-radius: 6px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  vertical-align: middle;
}
.details {
  color: var(--vp-c-text-2);
  font-style: italic;
}
</style>
