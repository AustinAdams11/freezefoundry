---
name: Apify Actor
description: Structure for Apify Store Actors (scrapers and automations).
triggers: [apify, actor, scraper, scrape, crawl]
roles: [planner, builder, reviewer]
enabled: true
---

An Actor project has:
- package.json with "type": "module", dependency "apify", and "start": "node src/main.js".
- src/main.js:
    import { Actor } from 'apify';
    await Actor.init();
    const input = (await Actor.getInput()) ?? {};
    // ... do the work, validating input fields first ...
    await Actor.pushData(results);   // one object per result
    await Actor.exit();
- .actor/actor.json: { "actorSpecification": 1, "name": "<kebab-name>", "version": "0.1", "input": "./input_schema.json" }
- .actor/input_schema.json describing every input field with a title, type, description and sensible default.

Rules: scrape only public pages, respect robots.txt and rate limits, never collect personal data the goal does not need, and write one file per proposal (start with src/main.js).
