/**
 * Prepares a camera photo for invoice OCR in the browser.
 * Large phone photos are resized before upload to keep the request fast
 * and below the server limit without reducing invoice text readability.
 */
export async function prepareInvoiceImage(file: File): Promise<File> {
  if (file.size <= 1_500_000 && file.type === "image/jpeg") return file;

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("No se pudo cargar la imagen"));
      image.src = objectUrl;
    });

    const maxSide = 1400;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo preparar la imagen");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const toBlob = (quality: number) =>
      new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", quality);
      });

    let blob = await toBlob(0.72);
    if (!blob) throw new Error("No se pudo comprimir la imagen");
    if (blob.size > 2_500_000) blob = await toBlob(0.6);
    if (!blob) throw new Error("No se pudo comprimir la imagen");

    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
