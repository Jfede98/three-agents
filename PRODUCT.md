# Product

<!-- impeccable:product-schema 1 -->

## Platform

Web: Next.js, React, a Convex backend and a React Three Fiber scene.

## Users

Commercial managers and regional supervisors who decide replenishment and local promotions. They need to compare customer queries, inventory and catalog signals in one place.

## Product Purpose

Turn operational signals into a specific proposal with a product, city, quantity and explanation. A person approves or rejects every proposed action.

## Current Scope

- Independent development project using a local Convex database and reactive functions.
- Three deterministic analyzers: customer queries, inventory, and promotions. They use explicit rules; this version does not perform generative AI inference.
- Existing synthetic dataset and Farmaenlace scenario retained, with Guayaquil, Quito and Cuenca.
- Analysis only proposes. Approval updates simulated inventory up to its target and applies a local promotion when included. Rejection records the decision without replenishing.
- Expired and outdated proposals cannot be applied. Repeated decisions are idempotent.
- No real WhatsApp, enterprise inventory, catalog or payment integration.
- No authentication or per-user authorization yet; decisions use a demonstration actor.

## Brand and Language

Retain the existing Farmaenlace visual scenario and its navy, lime and gray palette. Use direct operational Spanish for Ecuador. Label data as synthetic and analysis as rule-based; do not imply a live enterprise integration or a language model.

## Product Principles

1. Propose first; a human decides.
2. Show the evidence and distinguish simulated observations from projections.
3. Give concrete quantities, locations and durations.
4. Preserve the current dataset while improving the independent project.
5. Do not invent customer results, measured impact or production readiness.
