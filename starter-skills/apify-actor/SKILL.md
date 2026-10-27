---
name: Apify Actor
description: Structure for Apify Store Actors (scrapers and automations).
triggers: [apify, actor, scraper, scrape, crawl]
roles: [planner, builder]
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
- .actor/actor.json: { "actorSpecification": 1, "name": "<kebab-name>", "version": "0.1", "input": "./input_schema.json", "output": "./output_schema.json" }
- .actor/output_schema.json (Apify requires it to publish): { "actorOutputSchemaVersion": 1, "title": "...", "properties": { "results": { "type": "string", "title": "Results", "template": "{{links.apiDefaultDatasetUrl}}/items" } } }
- .actor/input_schema.json in Apify's format, exactly this shape:
    { "title": "...", "type": "object", "schemaVersion": 1,
      "properties": { "<field>": { "title": "...", "type": "string|integer|boolean|array|object", "description": "...", "editor": "textfield|stringList|...", "prefill": ... } },
      "required": ["<field>"] }
  Every property needs title, type and description; "required" is a top-level array, never a per-field flag.

Rules for the code: scrape only public pages, keep requests sequential or lightly concurrent, never collect personal data the goal does not need, and write exactly the one file the goal names.
