# IAE Business School · Universidad Austral Ecosystem Hub

Azure-ready static package with browser Excel import.

## Import behavior
Admin Team > Import Data reads XLSX/XLS locally, previews records, skips duplicate DNI values, preserves raw columns in Data Warehouse, and updates the in-page database/dashboard. Imported records are session-only and reset on page refresh.

## Deploy
Replace the root website files in the existing GitHub repository. Keep `.github/workflows` unchanged. Azure Static Web Apps redeploys automatically.
