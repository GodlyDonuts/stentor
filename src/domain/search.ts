export interface JobSearchFilters {
  query: string;
  program: string | null;
  cycle: string | null;
  location: string | null;
  sponsorship: string | null;
  remoteOnly: boolean;
  requireLink: boolean;
}

export const emptySearchFilters: JobSearchFilters = {
  query: "",
  program: null,
  cycle: null,
  location: null,
  sponsorship: null,
  remoteOnly: false,
  requireLink: false,
};
