const job = ["jobId", "Job", "jobs"], vehicle = ["vehicleId", "Vehicle", "vehicles"], route = ["routeId", "Route", "routes"];
const FIELD_ACTIONS = [
  ["demo_jobs", "Load fictional jobs", []],
  ["import_jobs", "Import Commercial Office jobs", []],
  ["add_vehicle", "Add truck", [["name", "Truck name", "text"], ["capacity", "Container capacity", "number", "20"], ["heightCm", "Height (cm)", "number", "350"], ["weightKg", "Gross weight (kg)", "number", "16000"], ["widthCm", "Width (cm)", "number", "250"], ["lengthCm", "Length (cm)", "number", "1000"]]],
  ["review_job_conflict", "Review driver version conflict", [job, ["reason", "Supervisor review reason", "text"]]],
  ["configure_job", "Set expected bins and service time", [job, ["containers", "Expected bin count", "number", "2"], ["serviceMinutes", "Service minutes", "number", "20"]]],
  ["cancel_field_job", "Cancel uncollected field job", [job, ["reason", "Reason", "text"]]],
  ["set_vehicle_availability", "Set truck availability", [vehicle, ["available", "Available", "boolean"]]],
  ["create_route", "Plan route", [vehicle, ["driverId", "Driver", "drivers"], ["date", "Route date", "date", "2026-11-15"], ["jobIds", "Select jobs", "jobs*"], ["startMinute", "Shift start", "time", "08:00"], ["breakMinutes", "Break (minutes)", "number", "30"], ["dayLimit", "Regular shift (minutes)", "number", "480"]]],
  ["resequence_route", "Reorder stops", [route, ["order", "Job references in order (comma separated)", "list"]]],
  ["reassign_job", "Reassign job", [job, ["driverId", "New driver", "drivers"]]],
  ["start_job", "Driver: start", [job]],
  ["arrive_job", "Driver: arrive", [job]],
  ["scan_bin", "Driver: collect bin", [job, ["barcode", "Fictional bin", "text", "DEMO-BIN-0001"]]],
  ["complete_job", "Driver: complete", [job, ["production", "Production", "number", "2"], ["acknowledgment", "Fictional acknowledgment", "text", "demo-customer"]]],
  ["job_exception", "Driver: exception", [job, ["reason", "Exception", "text"]]],
  ["review_exception", "Review exception", [job, ["reason", "Review note", "text"]]],
  ["authorize_demo_destruction", "Authorize SAMPLE evidence", [job, ["reason", "Reason", "text"]]],
  ["perform_demo_destruction", "Driver: record SAMPLE performed", [job]],
  ["issue_certificate", "Issue SAMPLE certificate", [job]],
  ["void_certificate", "Void SAMPLE certificate", [["certificateId", "Certificate", "certificates"], ["reason", "Reason", "text"]]],
  ["set_delivery", "Set fictional recipient", [["accountId", "Account reference", "text", "demo-account"], ["recipient", "Recipient alias", "text", "demo-office"], ["timezone", "Timezone", "text", "America/Indiana/Indianapolis"], ["consent", "Consent", "boolean"]]],
  ["batch_certificates", "Prepare daily draft batches", []],
  ["review_batch", "Review exhausted certificate delivery", [["batchId", "Failed batch", "batches"], ["reason", "Review reason", "text"]]],
  ["deliver_batch", "Simulate delivery", [["batchId", "Batch", "batches"], ["outcome", "Outcome", "choice", "success|failure|bounce"]]],
  ["telemetry", "Load synthetic observation", [vehicle, ["timestamp", "Time (ISO UTC)", "text"], ["latitude", "Latitude", "decimal", "39.77"], ["longitude", "Longitude", "decimal", "-86.16"], ["odometer", "Odometer", "number", "1000"], ["diagnostic", "Diagnostic", "text", "demo-normal"]]],
  ["navigation", "Simulate navigation handoff", [route]],
  ["request_export", "Queue export snapshot", []],
  ["advance_export", "Process 100 export rows", [["exportId", "Export", "exports"]]],
  ["handoff_billing", "Send completion to billing", [job]]
];
export {
  FIELD_ACTIONS
};
