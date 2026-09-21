---
starter_id: 10x-astro-starter
package_manager: npm
project_name: planner
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

A solo manager is shaping a 3-week, after-hours MVP for a single gas station's monthly shift scheduling, with auth (email+password login, two roles) as the only technology-forcing feature from the PRD's FRs. 10x Astro Starter is the vetted recommended default for `(web-app, js)` and clears all four agent-friendly gates (typed, convention-based, popular in training, well-documented), giving auth, database, and edge deployment out of the box without assembling those pieces separately — a good match for a tight solo timeline. Payments, realtime, AI, and background jobs are all out of scope per the PRD. Deployment defaults to Cloudflare Pages (the starter's own default); CI runs on GitHub Actions with auto-deploy-on-merge.
