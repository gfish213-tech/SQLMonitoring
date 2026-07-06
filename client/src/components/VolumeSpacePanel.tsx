import type { VolumeSpaceRow } from "../types";

export function VolumeSpacePanel({ volumeSpace }: { volumeSpace: VolumeSpaceRow[] }) {
  return (
    <section id="panel-volumespace" className="panel">
      <div className="panel-header">
        <h2>Disk Volume Space</h2>
      </div>
      {volumeSpace.length === 0 ? (
        <div className="empty-panel">No volume information available.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Volume</th>
                <th>Label</th>
                <th>Total</th>
                <th>Free</th>
                <th>Free %</th>
              </tr>
            </thead>
            <tbody>
              {volumeSpace.map((v) => (
                <tr key={v.volumeMountPoint} className={v.freePercent < 10 ? "blocked-row" : ""}>
                  <td>{v.volumeMountPoint}</td>
                  <td>{v.logicalVolumeName || "-"}</td>
                  <td>{v.totalGb.toLocaleString()} GB</td>
                  <td>{v.freeGb.toLocaleString()} GB</td>
                  <td>{v.freePercent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
