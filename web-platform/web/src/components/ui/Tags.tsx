import { DOWNLOAD_REQUEST_STATUS_COLOR, DOWNLOAD_REQUEST_STATUS_LABEL, PRIORITY_COLOR, PRIORITY_LABEL, STATUS_COLOR, STATUS_LABEL, tagBg } from "@/lib/constants";
import type { DownloadRequestStatus, IssuePriority, IssueStatus } from "@/lib/types/database";

export function StatusTag({ status }: { status: IssueStatus }) {
  const color = STATUS_COLOR[status];
  return (
    <span className="tag" style={{ background: tagBg(color), color }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityTag({ priority }: { priority: IssuePriority }) {
  const color = PRIORITY_COLOR[priority];
  return (
    <span className="tag" style={{ background: tagBg(color), color }}>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function StatusDot({ status }: { status: IssueStatus }) {
  return <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR[status], flex: "none" }} />;
}

/** Active/inactive account-status tag — shared by UsersTable and ProjectAdminsTable, which
 * previously each duplicated this exact color-mix formula inline. */
export function ActiveStatusTag({ status }: { status: "active" | "inactive" }) {
  const color = status === "active" ? "var(--status-resolved)" : "var(--priority-critical)";
  return (
    <span className="tag" style={{ background: tagBg(color), color }}>
      {status === "active" ? "Active" : "Inactive"}
    </span>
  );
}

export function DownloadRequestStatusTag({ status }: { status: DownloadRequestStatus }) {
  const color = DOWNLOAD_REQUEST_STATUS_COLOR[status];
  return (
    <span className="tag" style={{ background: tagBg(color), color }}>
      {DOWNLOAD_REQUEST_STATUS_LABEL[status]}
    </span>
  );
}
