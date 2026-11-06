/** ベースブランチの候補。上から順に、在るものを使う（origin/HEAD が指すブランチ、手元の main、master） */
export const BASE_REF_CANDIDATES = ["refs/remotes/origin/HEAD", "refs/heads/main", "refs/heads/master"];
