import type { RemoteIssue } from '../github/gh-cli';

interface IssueSpec {
  number: number;
  title: string;
  body: string;
  labels: string[];
  author: string;
  updatedMinAgo: number;
}

/** Fictional open issues of the demo repositories (never stored, never read from GitHub). */
const SPECS: Record<string, { name: string; issues: IssueSpec[] }> = {
  repo_demo_ely_unity: {
    name: 'elyndor-unity',
    issues: [
      { number: 214, title: 'La caméra traverse les murs dans les couloirs étroits', body: 'En vue à l’épaule, la caméra passe derrière les murs du donjon de Brume. Reproduire : couloir nord, se coller au mur et tourner.', labels: ['bug', 'caméra'], author: 'lina-qa', updatedMinAgo: 40 },
      { number: 209, title: 'Ajouter le tri de l’inventaire par rareté', body: 'Un bouton « Trier » qui range les objets par rareté puis par nom, sans toucher aux cases verrouillées.', labels: ['enhancement'], author: 'marc-design', updatedMinAgo: 60 * 5 },
      { number: 201, title: 'Les sous-titres ne suivent pas la langue choisie', body: 'Les dialogues restent en anglais quand le jeu est en français après un rechargement de partie.', labels: ['bug', 'localisation'], author: 'lina-qa', updatedMinAgo: 60 * 30 },
    ],
  },
  repo_demo_ely_backend: {
    name: 'elyndor-backend',
    issues: [
      { number: 77, title: 'Expirer les salons de matchmaking inactifs', body: 'Un salon sans joueur depuis 10 minutes doit être fermé et son code libéré.', labels: ['matchmaking'], author: 'sam-backend', updatedMinAgo: 90 },
    ],
  },
  repo_demo_cloud: {
    name: 'codeo-cloud',
    issues: [
      { number: 132, title: 'Relance automatique des factures impayées', body: 'Envoyer un rappel à J+7 puis J+15 après l’échéance, désactivable par client.', labels: ['billing', 'enhancement'], author: 'nora-pm', updatedMinAgo: 25 },
      { number: 128, title: 'Le filtre par période ignore le fuseau horaire', body: 'Une facture du 31 à 23 h (Paris) apparaît dans le mois suivant.', labels: ['bug', 'web'], author: 'paul-support', updatedMinAgo: 60 * 8 },
    ],
  },
};

/** The demo issues of a repository, or null when the repository has no demo issues. */
export function demoIssues(repositoryId: string, now = new Date()): RemoteIssue[] | null {
  const spec = SPECS[repositoryId];
  if (!spec) return null;
  return spec.issues.map((i) => ({
    number: i.number,
    title: i.title,
    body: i.body,
    url: `https://example.com/demo/${spec.name}/issues/${i.number}`,
    labels: i.labels,
    author: i.author,
    updatedAt: new Date(now.getTime() - i.updatedMinAgo * 60_000).toISOString(),
  }));
}
