# Grade Query · Student Reports and Publishing Workspace

[中文说明](README.md) · [Illustrated publishing guide](guide.html) · [Input format](docs/INPUT_FORMAT.md)

A static student report viewer and a browser-based publisher for approved school workflows. It presents totals, subject scores, rankings, item-level performance, and history for one student at a time. The separate [Exam Quality Analysis project](https://github.com/yusheng266186-beep/zhiliang-huixi-new-) is for cohort and classroom analysis.

## Reviewer and publisher workflows

- **Review a report:** use the identifier issued through the authorized workflow. Compare the exam title, subject dates, and scope before reading a rank or trend.
- **Prepare an exam:** start from a template in [templates](templates/). Import the workbook in [publisher.html](publisher.html). Review validation, missing values, and student matching. An entered zero remains a measured score.
- **Add history or item detail:** restore the appropriate local backup, then add an exam or supplement item results for its matching exam code. Check the preview and the records selected for export.
- **Review publication:** the publisher generates an encrypted package and checksums. Where an individual-report index is configured, the viewer fetches the selected encrypted report and checks its digest. See [individual-report documentation](docs/INDIVIDUAL_RECORDS.md).

## Data handling

The publisher's project backups can contain readable student data. Keep them and the original workbooks in approved storage. Public Pages URLs are discoverable and <code>noindex</code> is a search setting. Before using the workflow with actual school records, confirm the institution's authorized audience, access policy, and publication location. Use fabricated input to study or test the public repository.

Run <code>python3 -m http.server 8080</code> from the repository root to preview the static interface. The local Excel and ZIP components live in <code>vendor/</code>. The Chinese guide covers the exact publishing operation and standard checks.
