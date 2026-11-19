// "Save as a picture" for the relationship map: PNG or SVG, print colors or the theme on screen,
// with or without the impact of the selected system, and a preview of what will be saved.
import { useEffect, useMemo, useState } from 'react';
import { Radio, Stack, Text } from '@mantine/core';
import { Button, Checkbox, errorMessage, formatDateTime, lookupColor, Modal, useAuth, useLookup, useToast } from '../../core';
import type { Layout, PlacedNode } from './mapLayout';
import { pictureName, readPalette, renderMapSvg, saveFile, svgToPng } from './mapExport';
import { todayIso } from './shared';

export interface MapPictureProps {
  open: boolean;
  onClose: () => void;
  layout: Layout;
  /** Heading drawn on the picture and the start of the file name. */
  title: string;
  /** What the current view shows, for example "Systems arranged by criticality". */
  details?: string;
  selected?: PlacedNode | null;
  impacted?: Set<string>;
}

export function MapPictureDialog({ open, onClose, layout, title, details, selected, impacted }: MapPictureProps) {
  const toast = useToast();
  const { appName } = useAuth();
  const tiers = useLookup('criticality_tier');
  const [format, setFormat] = useState<'png' | 'svg'>('png');
  const [colors, setColors] = useState<'print' | 'current'>('print');
  const [showImpact, setShowImpact] = useState(true);
  const [busy, setBusy] = useState(false);
  const canShowImpact = !!selected && selected.type === 'system' && !!impacted?.size;

  const picture = useMemo(() => {
    if (!open) return null;
    const palette = readPalette(colors);
    const impact = canShowImpact && showImpact;
    return renderMapSvg(layout, {
      palette,
      title,
      subtitle: [`${appName} · ${formatDateTime(new Date())}`, details, impact ? `Affected if ${selected!.label} fails, outlined in red` : null].filter(Boolean).join(' · '),
      selectedId: impact ? selected!.id : null,
      impacted: impact ? impacted : null,
      tiers: tiers.map((t) => ({ label: t.label, color: palette.colors[lookupColor('criticality_tier', t.value)].solid })),
      criticalityColor: (n) => (n.attrs?.criticality ? palette.colors[lookupColor('criticality_tier', n.attrs.criticality)].solid : null),
    });
  }, [open, colors, layout, title, details, appName, canShowImpact, showImpact, selected, impacted, tiers]);

  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!picture) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(new Blob([picture.svg], { type: 'image/svg+xml;charset=utf-8' }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [picture]);

  async function save() {
    if (!picture) return;
    setBusy(true);
    try {
      const blob = format === 'svg'
        ? new Blob([picture.svg], { type: 'image/svg+xml;charset=utf-8' })
        : await svgToPng(picture.svg, picture.width, picture.height);
      saveFile(blob, pictureName(title, todayIso(), format));
      toast.success(format === 'svg' ? 'The map was saved as an SVG drawing.' : 'The map was saved as a PNG picture.');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Save the map as a picture" onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="download" loading={busy} onClick={() => void save()}>Save picture</Button></>}>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          The picture shows the whole map as it is filtered and arranged now, whatever the zoom, with a heading and a legend.
        </Text>
        <div className="inv-picture-options">
          <Radio.Group label="Format" value={format} onChange={(v) => setFormat(v as 'png' | 'svg')}>
            <Stack gap={8} mt={6}>
              <Radio value="png" label="PNG picture" description="For documents, slides and email" />
              <Radio value="svg" label="SVG drawing" description="Sharp at any size; opens in drawing programs" />
            </Stack>
          </Radio.Group>
          <Radio.Group label="Colors" value={colors} onChange={(v) => setColors(v as 'print' | 'current')}>
            <Stack gap={8} mt={6}>
              <Radio value="print" label="For printing" description="Light colors on a white page" />
              <Radio value="current" label="As on screen" description="The theme you are using now" />
            </Stack>
          </Radio.Group>
        </div>
        {canShowImpact && (
          <Checkbox label={`Show what is affected if ${selected!.label} fails`} checked={showImpact} onChange={setShowImpact} />
        )}
        {preview && picture && (
          <figure className="inv-picture-preview">
            <img src={preview} alt={`Preview of the picture: ${title}`} />
            <figcaption className="muted">
              {picture.width.toLocaleString()} × {picture.height.toLocaleString()} pixels{format === 'png' ? ', saved at up to twice that size' : ''}
            </figcaption>
          </figure>
        )}
      </Stack>
    </Modal>
  );
}
