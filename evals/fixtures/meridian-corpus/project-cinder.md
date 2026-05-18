---
status: active
owner: Dana Okoro
updated: 2026-05-10
budget: 3100000
due: 2026-12-20
tags: [project, avionics, core]
---

# Project Cinder

Project Cinder is the shared avionics core used by every flight system at Meridian. It is a radiation-tolerant flight computer plus the firmware stack that runs on it.

Cinder is a foundational program: it does not depend on any other project. Instead, many projects depend on Cinder. Directly, [[Project Talos]], [[Project Beacon]], and [[Project Aster]] all build on the Cinder core.

The project is owned by Dana Okoro, who leads avionics and guidance. Cinder's flight computer clocks at 600 megahertz and carries 256 megabytes of error-corrected memory.

Because Cinder sits at the bottom of the dependency graph, a schedule slip on Cinder cascades to most of the company. This risk is tracked in the [[Avionics Review]] meeting notes.
