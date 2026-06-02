import html2canvas from "html2canvas";

const FILE_PREFIX = "bedflow-report";

function fileName() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  return `${FILE_PREFIX}-${stamp}.png`;
}

async function elementToCanvas(el) {
  return html2canvas(el, {
    scale: window.devicePixelRatio > 1 ? 2 : 1.5,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
    windowWidth: el.scrollWidth,
    windowHeight: el.scrollHeight,
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))), "image/png", 1);
  });
}

export async function snapshotDownload(el) {
  const canvas = await elementToCanvas(el);
  const link = document.createElement("a");
  link.download = fileName();
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export async function snapshotCopy(el) {
  if (!navigator.clipboard || typeof window.ClipboardItem === "undefined")
    throw new Error("Clipboard image copy not supported on this device");
  const canvas = await elementToCanvas(el);
  const blob = await canvasToBlob(canvas);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

export function snapshotCanShare() {
  if (typeof navigator.share !== "function") return false;
  if (typeof navigator.canShare !== "function") return true;
  try {
    const probe = new File([new Blob([""], { type: "image/png" })], "x.png", { type: "image/png" });
    return navigator.canShare({ files: [probe] });
  } catch { return false; }
}

export async function snapshotShare(el) {
  if (!snapshotCanShare()) throw new Error("Sharing not supported on this device");
  const canvas = await elementToCanvas(el);
  const blob = await canvasToBlob(canvas);
  const file = new File([blob], fileName(), { type: "image/png" });
  await navigator.share({
    files: [file],
    title: "BedFlow Report",
    text: "Bed occupancy snapshot from BedFlow",
  });
}
