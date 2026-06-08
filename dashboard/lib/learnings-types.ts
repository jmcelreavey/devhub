export interface LearningEntry {
  category: string;
  title: string;
  size: number;
  modified: number;
  lineCount: number;
  preview: string;
}

export interface LearningDetail extends LearningEntry {
  content: string;
}
