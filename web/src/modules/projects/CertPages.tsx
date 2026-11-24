import { Link } from 'react-router-dom';
import { Group } from '@mantine/core';
import { LookupChip, RecordPage, ResourceList } from '../../core';

// E41-08: certifiable items and their requirements across every project, and their own record
// pages (history, comments and evidence files). They are added and verified on a project's
// Certification tab.

export function CertItemList() {
  return (
    <ResourceList
      type="cert_item"
      title="Certifiable items"
      columns={['ref', 'name', 'project_id', 'category', 'required', 'status', 'requirements_open', 'owner_id']}
      filters={['status', 'category', 'required', 'project_id', 'owner_id']}
      actions={<Link className="btn btn-secondary" to="/projects/certification-requirements">All requirements</Link>}
    />
  );
}

export function CertRequirementList() {
  return (
    <ResourceList
      type="cert_requirement"
      title="Certification requirements"
      columns={['ref', 'title', 'item_id', 'project_id', 'verification_method', 'owner_id', 'due_on', 'status']}
      filters={['status', 'verification_method', 'owner_id', 'project_id', 'item_id']}
      actions={<Link className="btn btn-secondary" to="/projects/certifiable-items">All certifiable items</Link>}
    />
  );
}

export function CertItemPage() {
  return (
    <RecordPage
      type="cert_item"
      status={(row) => <Group gap={6} component="span" display="inline-flex"><LookupChip list="cert_item_status" value={row.status} /></Group>}
      breadcrumbs={[{ label: 'Certifiable items', to: '/projects/certifiable-items' }]}
      summaryFields={['name', 'project_id', 'description', 'category', 'required', 'owner_id', 'status', 'requirements_total', 'requirements_open']}
    />
  );
}

export function CertRequirementPage() {
  return (
    <RecordPage
      type="cert_requirement"
      status={(row) => <LookupChip list="cert_requirement_status" value={row.status} />}
      breadcrumbs={[{ label: 'Certification requirements', to: '/projects/certification-requirements' }]}
      summaryFields={[
        'title', 'item_id', 'project_id', 'requirement', 'basis', 'verification_method', 'status', 'owner_id', 'due_on',
        'evidence_ref', 'verification_notes', 'verified_by', 'verified_on',
      ]}
    />
  );
}
