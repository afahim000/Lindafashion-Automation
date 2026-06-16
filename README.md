# PO to EDI Automation Workflow

A Node.js/React workflow for converting purchase order data into EDI-ready CSV files and automating parts of the upload process into an EDI system.

## Features
- Parses purchase order data and prepares CSV files for EDI upload
- Lists pending CSV files and tracks upload progress
- Uses environment variables for private EDI credentials
- Handles vendor lookup and upload status checks
- Separates private company-specific spreadsheet logic from the public repo

## Tech Stack
- Node.js
- Express
- React
- Puppeteer
- JavaScript
- dotenv

## Security
Credentials are stored in a local `.env` file and excluded from GitHub.
A `.env.example` file is provided for setup.
