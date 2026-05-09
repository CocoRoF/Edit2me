// i18n 사전. 키는 점-구분 도메인.
// 영어가 필요한 시점만 ko 외에 추가. 미존재 키는 ko 로 fallback.

export type Locale = 'ko' | 'en';

export const SUPPORTED_LOCALES: ReadonlyArray<Locale> = ['ko', 'en'];

type Dict = Readonly<Record<string, string>>;

const ko: Dict = {
  // 공통
  'common.brand': 'Edit2me',
  'common.tagline': '자체 엔진 PDF 편집기',
  'common.cancel': '취소',
  'common.confirm': '확인',
  'common.add': '추가',
  'common.save': '저장',
  'common.close': '닫기',
  'common.home': '처음으로',
  'common.loading': '로드 중...',
  'common.processing': '처리 중...',

  // 랜딩
  'landing.hero.title': 'PDF를 브라우저에서 바로 편집',
  'landing.hero.subtitle':
    '텍스트 편집·페이지 재배치·병합. 외부 PDF 라이브러리 없이 자체 엔진으로 동작하며, 업로드한 파일은 24시간 후 자동 삭제됩니다.',
  'landing.feature.editText': '텍스트 편집',
  'landing.feature.addText': '텍스트 추가',
  'landing.feature.reorder': '페이지 재배치',
  'landing.feature.delete': '페이지 삭제',
  'landing.feature.merge': '여러 PDF 병합',
  'landing.feature.merge.hint': '여러 파일 업로드',
  'landing.feature.encrypted': '암호화 PDF 거부',
  'landing.feature.encrypted.hint': '안전 정책',
  'landing.footer': '외부 PDF 라이브러리를 사용하지 않는 자체 엔진. PDF 명세 ISO 32000-1을 직접 구현.',

  // 드롭존
  'dropzone.dragOrPick': 'PDF를 끌어다 놓거나',
  'dropzone.multipleHint': '여러 파일을 한 번에 올리면 병합 모드로 진입합니다',
  'dropzone.pickFile': '파일 선택',
  'dropzone.maxSize': '최대 200 MB · application/pdf',

  // 에디터
  'editor.modified': '수정됨',
  'editor.saved': '저장됨',
  'editor.addText': '텍스트',
  'editor.download': '다운로드',
  'editor.zoom100': '100% 로 (⌘0)',
  'editor.undo': '실행 취소 (⌘Z)',
  'editor.redo': '다시 실행 (⌘⇧Z)',
  'editor.help': '키보드 단축키 (?)',
  'editor.diagnostics': '진단',

  // 사이드바
  'sidebar.pages': '페이지',
  'sidebar.selected': '선택',
  'sidebar.rotate.right': '회전',
  'sidebar.rotate.left': '역회전',
  'sidebar.delete': '삭제',

  // 배너
  'banner.fontDiagnostics': '일부 폰트의 텍스트는 편집/표시가 제한됩니다.',
  'banner.detected': '건 감지',
  'banner.details': '자세히',

  // 진단 패널
  'diag.title': '진단',
  'diag.empty': '감지된 진단이 없습니다. 모든 폰트가 정상적으로 디코드됐어요.',
  'diag.cmapHint':
    'ToUnicode CMap 부재 시 npm run build:cmaps 실행을 권장합니다.',

  // 도움말
  'help.title': '키보드 단축키',
  'help.section.edit': '편집',
  'help.section.undoRedo': '실행 취소 / 다시',
  'help.section.pages': '페이지',
  'help.section.view': '뷰 / 저장',
  'help.macHint': 'Mac 의 ⌘ 는 Windows 에서 Ctrl 로 동일하게 동작합니다.',

  // 병합
  'merge.title': '병합',
  'merge.docCount': '문서',
  'merge.selectedCount': '페이지 선택',
  'merge.cta': '병합 완료',
  'merge.empty': '왼쪽 사이드바에서 페이지를 클릭해 추가',
  'merge.emptyHint': '추가된 페이지는 드래그로 순서 변경, X로 제거',

  // 텍스트 추가 다이얼로그
  'addText.title': '텍스트 추가',
  'addText.placeholder':
    '텍스트를 입력하세요. (코어 14 폰트는 한글 표시 불가 — 한글은 v0.2 사용자 TTF 업로드로)',

  // 토스트/에러
  'toast.downloadStart': '다운로드 시작',
};

const en: Dict = {
  'common.brand': 'Edit2me',
  'common.tagline': 'Self-engine PDF editor',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.add': 'Add',
  'common.save': 'Save',
  'common.close': 'Close',
  'common.home': 'Home',
  'common.loading': 'Loading…',
  'common.processing': 'Processing…',

  'landing.hero.title': 'Edit PDFs right in your browser',
  'landing.hero.subtitle':
    'Text editing, page reorder, merge. Powered by a self-built engine — no external PDF libraries. Uploaded files are deleted after 24 hours.',
  'landing.feature.editText': 'Edit text',
  'landing.feature.addText': 'Add text',
  'landing.feature.reorder': 'Reorder pages',
  'landing.feature.delete': 'Delete pages',
  'landing.feature.merge': 'Merge PDFs',
  'landing.feature.merge.hint': 'Drop multiple files',
  'landing.feature.encrypted': 'Encrypted PDFs rejected',
  'landing.feature.encrypted.hint': 'Safety policy',
  'landing.footer':
    'Self-built engine, no external PDF libraries — direct implementation of the PDF spec (ISO 32000-1).',

  'dropzone.dragOrPick': 'Drop a PDF or',
  'dropzone.multipleHint': 'Drop multiple files to enter merge mode',
  'dropzone.pickFile': 'Pick file',
  'dropzone.maxSize': 'Max 200 MB · application/pdf',

  'editor.modified': 'Modified',
  'editor.saved': 'Saved',
  'editor.addText': 'Text',
  'editor.download': 'Download',
  'editor.zoom100': '100% (⌘0)',
  'editor.undo': 'Undo (⌘Z)',
  'editor.redo': 'Redo (⌘⇧Z)',
  'editor.help': 'Keyboard shortcuts (?)',
  'editor.diagnostics': 'Diagnostics',

  'sidebar.pages': 'pages',
  'sidebar.selected': 'selected',
  'sidebar.rotate.right': 'Rotate right',
  'sidebar.rotate.left': 'Rotate left',
  'sidebar.delete': 'Delete',

  'banner.fontDiagnostics': "Some fonts' text has limited editing/display.",
  'banner.detected': ' detected',
  'banner.details': 'Details',

  'diag.title': 'Diagnostics',
  'diag.empty': 'No diagnostics. All fonts decoded successfully.',
  'diag.cmapHint':
    'When ToUnicode CMaps are missing, run `npm run build:cmaps` to bundle Adobe data.',

  'help.title': 'Keyboard shortcuts',
  'help.section.edit': 'Editing',
  'help.section.undoRedo': 'Undo / Redo',
  'help.section.pages': 'Pages',
  'help.section.view': 'View / Save',
  'help.macHint': '⌘ on Mac maps to Ctrl on Windows.',

  'merge.title': 'Merge',
  'merge.docCount': 'docs',
  'merge.selectedCount': 'pages selected',
  'merge.cta': 'Merge',
  'merge.empty': 'Click pages on the left to add to result',
  'merge.emptyHint': 'Drag to reorder, X to remove',

  'addText.title': 'Add text',
  'addText.placeholder':
    'Type your text. (Core 14 fonts cannot render CJK — for Korean text, see v0.2 user-TTF upload.)',

  'toast.downloadStart': 'Download started',
};

const dicts: Record<Locale, Dict> = { ko, en };

export function translate(locale: Locale, key: string): string {
  const d = dicts[locale];
  if (key in d) return d[key]!;
  // ko fallback
  if (key in dicts.ko) return dicts.ko[key]!;
  return key;
}
