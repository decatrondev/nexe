import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { Modal, ModalTitle, ModalFooter, Button } from "@nexe/ui";

interface ImageCropModalProps {
  imageSrc: string;
  /** "avatar" = 1:1 circle, "banner" = 5:2 rectangle */
  type: "avatar" | "banner";
  onConfirm: (croppedBlob: Blob) => void;
  onClose: () => void;
}

async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area,
  outputWidth: number,
  outputHeight: number,
): Promise<Blob> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = reject;
    image.src = imageSrc;
  });

  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext("2d")!;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputWidth,
    outputHeight,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas is empty"))),
      "image/webp",
      0.9,
    );
  });
}

export default function ImageCropModal({ imageSrc, type, onConfirm, onClose }: ImageCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  const isAvatar = type === "avatar";
  const aspect = isAvatar ? 1 : 5 / 2;
  const cropShape = isAvatar ? "round" as const : "rect" as const;
  const outputW = isAvatar ? 256 : 600;
  const outputH = isAvatar ? 256 : 240;

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  async function handleSave() {
    if (!croppedAreaPixels) return;
    setSaving(true);
    try {
      const blob = await getCroppedImg(imageSrc, croppedAreaPixels, outputW, outputH);
      onConfirm(blob);
    } catch {
      // fallback: upload original
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} maxWidth={isAvatar ? "max-w-md" : "max-w-2xl"}>
      <ModalTitle>{isAvatar ? "Crop Avatar" : "Crop Banner"}</ModalTitle>
      <p className="mb-3 text-sm text-slate-400">
        {isAvatar ? "Drag to reposition. Scroll to zoom." : "Drag to reposition. Scroll to zoom."}
      </p>

      <div
        className="relative overflow-hidden rounded-lg bg-dark-950"
        style={{ height: isAvatar ? 320 : 280 }}
      >
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          cropShape={cropShape}
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
          style={{
            containerStyle: { borderRadius: 8 },
          }}
        />
      </div>

      {/* Zoom slider */}
      <div className="mt-3 flex items-center gap-3">
        <svg className="h-4 w-4 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
        </svg>
        <input
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-dark-700 accent-nexe-500"
        />
        <svg className="h-4 w-4 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
        </svg>
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose} fullWidth>Cancel</Button>
        <Button onClick={handleSave} loading={saving} fullWidth>
          {isAvatar ? "Save Avatar" : "Save Banner"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
