export interface DouyinUrlList {
  url_list?: string[];
}

export interface DouyinBitRate {
  gear_name?: string;
  bit_rate?: number;
  is_h265?: number;
  height?: number;
  play_addr?: DouyinUrlList;
}

export interface DouyinVideo {
  play_addr?: DouyinUrlList;
  cover?: DouyinUrlList;
  duration?: number;
  bit_rate?: DouyinBitRate[];
}

export interface DouyinImage {
  url_list?: string[];
  download_url_list?: string[];
  width?: number;
  height?: number;
}

export interface DouyinItem {
  aweme_id?: string;
  desc?: string;
  author?: { nickname?: string };
  video?: DouyinVideo;
  images?: DouyinImage[];
}
