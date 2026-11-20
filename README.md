# May Harvest Corporation - Employee Training & Competency Management System

Enterprise HR & Compliance Management System for Employee Training, Qualification, Competency Testing, and Appointment Tracking with Real-Time Cloud Synchronization.

---

## 🌟 Key Features

1. **Executive Dashboard**: Real-time training metrics, completion rates, pass/fail ratios, calendar schedules, and open non-conformities.
2. **Position Catalog & Competency Matrix**: Department areas and mapped mandatory training requirements.
3. **Interactive Training Calendar**: Target scheduling, participant tagging, trainer assignment, and overdue tracking.
4. **Training Records Entry**: Automated grading (70% existing employees, 50% newly hired), certificate picture attachments, and bulk import.
5. **Training Needs Analysis (TNA)**: Automated gap detection against required position qualifications.
6. **Competency Questionnaires & Exams**: Automated multiple-choice test generator with answer keys.
7. **Appointment Letters (Teams)**: Generation of official team appointment letters and qualifications verification.
8. **Non-Conformity (NC) Monitoring**: Corrective actions, root cause analysis, target schedules, and closure audits.
9. **Real-Time Cloud Sync Engine**: Two-way synchronization across multiple plant stations and devices without data loss.
10. **Automated Disaster Recovery**: Hourly snapshot backups with one-click JSON export and restore.

---

## 🚀 Running Locally

```bash
# Clone the repository
git clone https://github.com/mayharvestcdc04-rgb/Employee-Training-and-Competency.git

# Enter project directory
cd Employee-Training-and-Competency

# Start the server (Zero external dependencies needed!)
npm start
```

Visit `http://localhost:3000` in your web browser.

---

## ☁️ Deployment on Render

This repository includes `render.yaml` and `Procfile` configured out-of-the-box for **Render Free Web Service**:

1. Log in to [Render Dashboard](https://dashboard.render.com).
2. Click **New +** ➔ **Web Service**.
3. Select `mayharvestcdc04-rgb/Employee-Training-and-Competency`.
4. Click **Deploy Web Service**.
5. Your system is live with automatic SSL and persistent cloud sync!

---

## 🔒 Compliance & Security

* **RA 10173 (Philippine Data Privacy Act of 2012)**: Sensitive employee qualification records protected and isolated.
* **Trail of Bits Security Standards**: Input sanitization, atomic filesystem writes, CORS isolation, and rate-limited sync endpoints.
* **Audit Ready**: Meets FSSC 22000, SQMS, SMETA, and GMP compliance requirements.

---
© 2026 May Harvest Corporation. All rights reserved.
