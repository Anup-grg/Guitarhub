#!/usr/bin/env bash
set -e
echo "Running GuitarHub validation pipeline..."
npm run check
echo "All checks passed!"
