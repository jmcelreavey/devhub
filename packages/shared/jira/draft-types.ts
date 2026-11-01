export interface JiraTicketDraft {
  summary: string;
  description: string;
}

export interface JiraTicketDraftResult extends JiraTicketDraft {
  warnings: string[];
}

