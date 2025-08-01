import { match } from "ts-pattern";

import { hiddenLabels, nonUserFacingLabels } from "./constants";
import { getMilestoneIssues, hasBeenReleased } from "./github";
import { issueNumberRegex } from "./linked-issues";
import { githubReleaseTemplate, websiteChangelogTemplate } from "./release-notes-templates";
import type { Issue, ReleaseProps } from "./types";
import {
  getDotXVersion,
  getEnterpriseVersion,
  getGenericVersion,
  getMajorVersion,
  getMinorVersion,
  getOSSVersion,
  isEnterpriseVersion,
  isPreReleaseVersion,
  isValidVersionString,
} from "./version-helpers";


const hasLabel = (issue: Issue, label: string) => {
  if (typeof issue.labels === "string") {
    return issue.labels.includes(label);
  }
  return issue.labels.some(tag => tag.name === label);
};

const isBugIssue = (issue: Issue) => {
  return hasLabel(issue, "Type:Bug");
};

const isAlreadyFixedIssue = (issue: Issue) => {
  return hasLabel(issue, ".Already Fixed");
};

const isNonUserFacingIssue = (issue: Issue) => {
  return nonUserFacingLabels.some(label => hasLabel(issue, label));
};

const isHiddenIssue = (issue: Issue) => {
  return hiddenLabels.some(label => hasLabel(issue, label));
};

const formatIssue = (issue: Issue) =>
  `- ${issue.title.trim()} (#${issue.number})`;

export const getDockerTag = (version: string) => {
  const dotXVersion = getDotXVersion(version);

  const imagePath = `${process.env.DOCKERHUB_OWNER}/${
    process.env.DOCKERHUB_REPO
  }${isEnterpriseVersion(version) ? "-enterprise" : ""}`;

  return `[\`${imagePath}:${dotXVersion}\`](https://hub.docker.com/r/${imagePath}/tags)`;
};

export const getDownloadUrl = (version: string) => {
  const dotXVersion = getDotXVersion(version);

  return `https://${process.env.AWS_S3_DOWNLOADS_BUCKET}/${
    isEnterpriseVersion(version) ? "enterprise/" : ""
  }${dotXVersion}/metabase.jar`;
};

export const getChangelogUrl = (version: string ) => {
  const majorVersion = getMajorVersion(version);
  const minorVersion = getMinorVersion(version);
  return `https://www.metabase.com/changelog/${majorVersion}#metabase-${majorVersion}${minorVersion}`
}

export const getReleaseTitle = (version: string) => {
  return `Metabase ${getGenericVersion(version)}`;
};

enum IssueType {
  bugFixes = "bugFixes",
  enhancements = "enhancements",
  alreadyFixedIssues = "alreadyFixedIssues",
  underTheHoodIssues = "underTheHoodIssues",
}

// Product area labels take the form of "Category/Subcategory", e.g., "Querying/MBQL"
// We're only interested in the main product category, e.g., "Querying"
enum ProductCategory {
  administration = "Administration",
  database = "Database",
  embedding = "Embedding",
  operation = "Operation",
  organization = "Organization",
  querying = "Querying",
  reporting = "Reporting",
  visualization = "Visualization",
  other = "Other",
}

type CategoryIssueMap = Record<Partial<ProductCategory>, Issue[]>;

type IssueMap = {
  [IssueType.bugFixes]: CategoryIssueMap;
  [IssueType.enhancements]: CategoryIssueMap;
  [IssueType.alreadyFixedIssues]: CategoryIssueMap;
  [IssueType.underTheHoodIssues]: CategoryIssueMap;
};

const getIssueType = (issue: Issue): IssueType => {
  return match(issue)
    .when(isNonUserFacingIssue, () => IssueType.underTheHoodIssues)
    .when(isAlreadyFixedIssue, () => IssueType.alreadyFixedIssues)
    .when(isBugIssue, () => IssueType.bugFixes)
    .otherwise(() => IssueType.enhancements);
};

const getLabels = (issue: Issue): string[] => {
  if (typeof issue.labels === "string") {
    return issue.labels.split(",");
  }
  return issue.labels.map(label => label.name || "");
};

const hasCategory = (issue: Issue, categoryName: ProductCategory): boolean => {
  const labels = getLabels(issue);
  return labels.some(label => label.includes(categoryName));
};

export const getProductCategory = (issue: Issue): ProductCategory => {
  const category = Object.values(ProductCategory).find(categoryName =>
    hasCategory(issue, categoryName)
  );

  return category ?? ProductCategory.other;
};

// Format issues for a single product category
const formatIssueCategory = (categoryName: ProductCategory, issues: Issue[]): string => {
  return `**${categoryName}**\n\n${issues.map(formatIssue).join("\n")}`;
};

// We want to alphabetize the issues by product category, with "Other" (uncategorized) issues as the caboose
const sortCategories = (categories: ProductCategory[]) => {
  const uncategorizedIssues = categories.filter(
    category => category === ProductCategory.other,
  );
  const sortedCategories = categories
    .filter(cat => cat !== ProductCategory.other)
    .sort((a, b) => a.localeCompare(b));

  return [
    ...sortedCategories,
    ...uncategorizedIssues,
  ];
};

// For each issue category ("Enhancements", "Bug Fixes", etc.), we want to group issues by product category
const formatIssues = (issueMap: CategoryIssueMap): string => {
  const categories = sortCategories(
    Object.keys(issueMap) as ProductCategory[],
  );

  return categories
    .map(categoryName => formatIssueCategory(categoryName, issueMap[categoryName]))
    .join("\n\n");
};

export const categorizeIssues = (issues: Issue[]) => {
  return issues
    .filter(issue => !isHiddenIssue(issue))
    .reduce((issueMap: IssueMap, issue: Issue) => {
      const issueType = getIssueType(issue);
      const productCategory = getProductCategory(issue);

      return {
        ...issueMap,
        [issueType]: {
          ...issueMap[issueType],
          [productCategory]: [
            ...issueMap[issueType][productCategory] ?? [],
            issue,
          ],
        },
      };
    }, {
      [IssueType.bugFixes]: {},
      [IssueType.enhancements]: {},
      [IssueType.alreadyFixedIssues]: {},
      [IssueType.underTheHoodIssues]: {},
    } as IssueMap);
};

export const generateReleaseNotes = ({
  version,
  issues,
  template,
}: {
  version: string;
  issues: Issue[];
  template: string;
}) => {
  const issuesByType = categorizeIssues(issues);

  const ossVersion = getOSSVersion(version);
  const eeVersion = getEnterpriseVersion(version);

  return template
    .replace("{{version}}", getGenericVersion(version))
    .replace(
      "{{enhancements}}",
      formatIssues(issuesByType.enhancements),
    )
    .replace(
      "{{bug-fixes}}",
      formatIssues(issuesByType.bugFixes),
    )
    .replace(
      "{{already-fixed}}",
      formatIssues(issuesByType.alreadyFixedIssues),
    )
    .replace(
      "{{under-the-hood}}",
      formatIssues(issuesByType.underTheHoodIssues),
    )
    .replace("{{ee-docker-tag}}", getDockerTag(eeVersion))
    .replace("{{ee-download-url}}", getDownloadUrl(eeVersion))
    .replace("{{oss-docker-tag}}", getDockerTag(ossVersion))
    .replace("{{oss-download-url}}", getDownloadUrl(ossVersion))
    .replaceAll("{{generic-version}}", getGenericVersion(version))
    .replace("{{changelog-url}}", getChangelogUrl(ossVersion));
};

export async function publishRelease({
  version,
  owner,
  repo,
  issues,
  github,
}: ReleaseProps & { oss_checksum: string, ee_checksum: string, issues: Issue[] }) {
  if (!isValidVersionString(version)) {
    throw new Error(`Invalid version string: ${version}`);
  }
  const payload = {
    owner,
    repo,
    tag_name: getOSSVersion(version),
    name: getReleaseTitle(version),
    body: generateReleaseNotes({
      version,
      issues,
      template: githubReleaseTemplate,
    }),
    draft: true,
    prerelease: isPreReleaseVersion(version), // this api arg has never worked, but maybe it will someday! 🤞
  };

  return github.rest.repos.createRelease(payload);
}

const issueLink = (issueNumber: string) => `https://github.com/metabase/metabase/issues/${issueNumber}`;

export function markdownIssueLinks(text: string) {
  return text?.replaceAll(issueNumberRegex, (_, issueNumber) => {
    return `([#${issueNumber}](${issueLink(issueNumber)}))`;
  }) ?? text ?? '';
}

export function getWebsiteChangelog({
  version,
  issues,
}: { version: string; issues: Issue[]; }) {
  if (!isValidVersionString(version)) {
    throw new Error(`Invalid version string: ${version}`);
  }

  const notes = generateReleaseNotes({
    version,
    issues,
    template: websiteChangelogTemplate,
  });

  return markdownIssueLinks(notes);
}

export async function getChangelog({
  version,
  owner,
  repo,
  github,
}: ReleaseProps) {
  if (!isValidVersionString(version)) {
    throw new Error(`Invalid version string: ${version}`);
  }
  const isAlreadyReleased = await hasBeenReleased({
    github,
    owner,
    repo,
    version,
  });

  const issues = await getMilestoneIssues({
    version,
    github,
    owner,
    repo,
    milestoneStatus: isAlreadyReleased ? "closed" : "open",
  });

  return generateReleaseNotes({
    template: githubReleaseTemplate,
    version,
    issues,
  });
}
