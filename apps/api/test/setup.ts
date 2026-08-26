// Loaded before any spec so the decorator metadata registry exists before the first DTO or
// provider class is evaluated. `src/bootstrap.ts` imports it too, but a spec is free to
// import a DTO directly, and metadata written after the fact is metadata nobody reads.
import 'reflect-metadata';
