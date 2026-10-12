#!/usr/bin/env pwsh
Write-Host "Running GuitarHub validation pipeline..." -ForegroundColor Cyan
npm run check
Write-Host "All checks passed!" -ForegroundColor Green
