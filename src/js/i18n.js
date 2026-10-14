/* =========================================================
   2. Language
   ========================================================= */
/* English is the source, so there is no English table: a string that is not in the
   Indonesian one is already what it should be. Keys are the English text itself
   rather than invented ids, which means a string nobody translated still reads
   correctly instead of showing "menu.file.open" to somebody.

   The function is called tr, not t: half the application already has a local `t`
   for the active tab or a tool, and a shadowed translator fails silently. */
const I18N = (function () {
  const ID = {
    /* ---- panes, bars and buttons ---- */
    "Explorer": "Folder", "Docs": "Dokumen", "Outline": "Kerangka", "Search": "Cari",
    "New": "Baru", "Edit": "Edit", "Split": "Terbagi", "Preview": "Pratinjau",
    "Save": "Simpan", "Settings": "Pengaturan", "Documents": "Dokumen",
    "Editor": "Editor", "Appearance": "Tampilan", "Language": "Bahasa",
    "words": "kata", "chars": "karakter", "lines": "baris", "min read": "menit baca",
    "Ln": "Brs", "Col": "Kol", "selected": "terpilih",

    /* ---- settings ---- */
    "Soft wrap": "Bungkus baris",
    "Sync scroll & selection": "Sinkron gulir & seleksi",
    "Sync scroll and selection": "Sinkron gulir dan seleksi",
    "Wide layout (use the whole window)": "Tata letak lebar (pakai seluruh jendela)",
    "Wide layout": "Tata letak lebar",
    "Editor text size": "Ukuran teks editor",
    "Preview text size": "Ukuran teks pratinjau",
    "Dark mode": "Mode gelap",
    "Change folder…": "Ganti folder…",
    "Open in Explorer": "Buka di Explorer",
    "Follow the system": "Ikuti sistem",
    "Everything in the Docs pane is a real Markdown file in this folder, written as you type. Nothing ever asks where to save it.":
      "Semua yang ada di panel Dokumen adalah berkas Markdown sungguhan di folder ini, ditulis sambil Anda mengetik. Tidak pernah ada yang menanyakan mau disimpan di mana.",
    "No folder - documents are kept in this browser only. Run Markdown Studio from its own program to keep them as files.":
      "Tidak ada folder - dokumen hanya tersimpan di browser ini. Jalankan Markdown Studio dari programnya sendiri agar tersimpan sebagai berkas.",
    "Setup only asks for this once. Change it here whenever you like.":
      "Setup hanya menanyakan ini sekali. Ubah di sini kapan saja.",

    /* ---- menu ---- */
    "Open folder": "Buka folder", "Save all files": "Simpan semua berkas",
    "Close all tabs": "Tutup semua tab", "Search in folder": "Cari di folder",
    "Save as Markdown": "Simpan sebagai Markdown", "Export as HTML": "Ekspor sebagai HTML",
    "Print / Save as PDF": "Cetak / Simpan sebagai PDF",
    "Copy HTML to clipboard": "Salin HTML ke papan klip",
    "Duplicate as new document": "Gandakan jadi dokumen baru",
    "Download backup (all docs)": "Unduh cadangan (semua dokumen)",
    "Import backup (.json)": "Impor cadangan (.json)",
    "Find and replace": "Cari dan ganti", "Toggle dark mode": "Mode gelap",
    "Keyboard shortcuts": "Pintasan papan tik",

    /* ---- find bar ---- */
    "Find": "Cari", "Replace with": "Ganti dengan", "Replace": "Ganti", "All": "Semua",
    "preview · read-only": "pratinjau · hanya baca",
    "Preview is read-only, so replace is off":
      "Pratinjau hanya bisa dibaca, jadi ganti dimatikan",
    "Match case": "Cocokkan huruf besar/kecil", "Regular expression": "Ekspresi reguler",
    "Next (Enter)": "Berikutnya (Enter)", "Previous (Shift+Enter)": "Sebelumnya (Shift+Enter)",
    "Close (Esc)": "Tutup (Esc)",

    /* ---- tooltips ---- */
    "Toggle sidebar (Ctrl+B)": "Buka/tutup panel samping (Ctrl+B)",
    "Document title": "Judul dokumen",
    "Editor only (Ctrl+1)": "Editor saja (Ctrl+1)", "Editor only": "Editor saja",
    "Split view (Ctrl+2)": "Tampilan terbagi (Ctrl+2)", "Split view": "Tampilan terbagi",
    "Preview only (Ctrl+3)": "Pratinjau saja (Ctrl+3)", "Preview only": "Pratinjau saja",
    "View mode": "Mode tampilan",
    "Find and replace (Ctrl+F)": "Cari dan ganti (Ctrl+F)",
    "Toggle theme (Ctrl+K Ctrl+T)": "Ganti tema (Ctrl+K Ctrl+T)", "More": "Lainnya",
    "Save as .md file (Ctrl+S)": "Simpan sebagai berkas .md (Ctrl+S)",
    "Save changes (Ctrl+S)": "Simpan perubahan (Ctrl+S)",
    "Already in sync (Ctrl+S)": "Sudah sinkron (Ctrl+S)",
    "New document (Ctrl+N)": "Dokumen baru (Ctrl+N)",
    "Open folder (Ctrl+K Ctrl+O)": "Buka folder (Ctrl+K Ctrl+O)",
    "Open .md file (Ctrl+O)": "Buka berkas .md (Ctrl+O)",
    "Close all tabs (Ctrl+K Ctrl+W)": "Tutup semua tab (Ctrl+K Ctrl+W)",
    "Open files": "Berkas yang terbuka",
    "Search documents...": "Cari dokumen...",
    "Search in all files...": "Cari di semua berkas...",
    "Search in folder (Ctrl+Shift+F)": "Cari di folder (Ctrl+Shift+F)",
    "Collapse / expand all": "Tutup / buka semua",
    "Re-read files from disk and search again": "Baca ulang berkas dari disk lalu cari lagi",
    "Smaller": "Perkecil", "Larger": "Perbesar", "Show me where": "Tunjukkan di mana",
    "Delete": "Hapus", "Markdown source": "Sumber Markdown",
    "New file": "Berkas baru", "Refresh": "Muat ulang", "Close folder": "Tutup folder",
    "Keep your documents somewhere else": "Simpan dokumen Anda di tempat lain",
    "Drop Markdown files to open": "Lepas berkas Markdown untuk membuka",

    /* ---- toolbar ---- */
    "Heading 1": "Judul 1", "Heading 2": "Judul 2", "Heading 3": "Judul 3",
    "Bold (Ctrl+B)": "Tebal (Ctrl+B)", "Italic (Ctrl+I)": "Miring (Ctrl+I)",
    "Strikethrough": "Coret", "Strikethrough (Alt+S)": "Coret (Alt+S)", "Inline code (Ctrl+`)": "Kode sebaris (Ctrl+`)",
    "Highlight": "Sorot", "Link (paste a URL over words)": "Tautan (tempel URL di atas kata)",
    "Image (or paste a screenshot)": "Gambar (atau tempel screenshot)",
    "Bullet list (Ctrl+Shift+8)": "Daftar butir (Ctrl+Shift+8)",
    "Numbered list (Ctrl+Shift+7)": "Daftar bernomor (Ctrl+Shift+7)",
    "Task list (Alt+C)": "Daftar tugas (Alt+C)",
    "Blockquote (Ctrl+Shift+.)": "Kutipan (Ctrl+Shift+.)",
    "Bullet list": "Daftar poin", "Numbered list": "Daftar bernomor",
    "Task list": "Daftar tugas", "Blockquote": "Kutipan", "Table": "Tabel",
    "Code block": "Blok kode", "Horizontal rule": "Garis pemisah", "Footnote": "Catatan kaki",

    /* ---- shortcuts sheet ---- */
    "Formatting": "Format", "Editing": "Mengedit", "Files": "Berkas", "Tabs": "Tab",
    "View": "Tampilan",
    "Bold": "Tebal", "Italic": "Miring", "Inline code": "Kode sebaris", "Link": "Tautan",
    "Image": "Gambar", "Heading 1 / 2 / 3": "Judul 1 / 2 / 3",
    "Indent / outdent": "Menjorok masuk / keluar", "Duplicate line": "Gandakan baris",
    "Move line up / down": "Pindah baris naik / turun", "Delete line": "Hapus baris",
    "Continue list": "Lanjutkan daftar", "Undo / redo": "Urungkan / ulangi",
    "Select all": "Pilih semua", "Open .md file": "Buka berkas .md",
    "New document": "Dokumen baru", "Print / PDF": "Cetak / PDF",
    "Next tab": "Tab berikutnya", "Previous tab": "Tab sebelumnya",
    "Go to tab 1-9": "Ke tab 1-9", "Close tab": "Tutup tab", "Close panel": "Tutup panel",
    "Toggle sidebar": "Buka/tutup panel samping", "Toggle theme": "Ganti tema",
    "Shortcuts": "Pintasan",

    /* ---- the folder tree ---- */
    "No folder open.": "Belum ada folder yang terbuka.",
    "Open one to browse and edit": "Buka satu untuk menjelajah dan mengedit",
    "all its Markdown files.": "semua berkas Markdown di dalamnya.",
    "Open Folder": "Buka Folder",
    "No Markdown files here.": "Tidak ada berkas Markdown di sini.",
    "Reopen ": "Buka lagi ", " (read-only)": " (hanya baca)",
    "Opened straight from a file, so folders here are read-only.":
      "Dibuka langsung dari berkas, jadi folder di sini hanya bisa dibaca.",

    /* ---- documents ---- */
    "No documents match.": "Tidak ada dokumen yang cocok.",
    "just now": "baru saja", "m ago": "m lalu", "h ago": "j lalu", "d ago": "h lalu",
    "Each of these is a file": "Setiap dokumen ini adalah berkas",
    "in here": "di folder ini",
    "Untitled": "Tanpa judul",

    /* ---- the save state ---- */
    "Saved": "Tersimpan", "Unsaved changes": "Ada perubahan belum tersimpan",
    "Read-only copy": "Salinan hanya baca", "Not saved": "Tidak tersimpan",
    "Browser only": "Hanya di browser", "Not written": "Gagal ditulis",
    "In sync with ": "Sinkron dengan ",
    "Written as you type to ": "Ditulis sambil mengetik ke ",
    "Could not write ": "Gagal menulis ",
    "Autosaved in this browser. Ctrl+S saves it as a real .md file on disk":
      "Tersimpan otomatis di browser ini. Ctrl+S menyimpannya sebagai berkas .md di disk",
    "Opened without write access - Ctrl+S saves a copy instead":
      "Dibuka tanpa izin tulis - Ctrl+S menyimpan salinannya",
    "Browser storage is unavailable here - use Ctrl+S to save a real file":
      "Penyimpanan browser tidak tersedia di sini - pakai Ctrl+S untuk menyimpan berkas sungguhan",

    /* ---- diagrams ---- */
    "Code": "Kode", "Copy": "Salin", "Diagram": "Diagram",
    "Show the Mermaid source": "Tampilkan sumber Mermaid",
    "Copy the Mermaid source": "Salin sumber Mermaid",
    "Save the diagram as a picture": "Simpan diagram sebagai gambar",
    "Save the diagram as SVG": "Simpan diagram sebagai SVG",
    "the first line should be \"flowchart TD\" (or graph LR, and TB, BT, RL work too) - only flowcharts are drawn here":
      "baris pertama harus \"flowchart TD\" (atau graph LR; TB, BT, RL juga bisa) - hanya flowchart yang digambar di sini",
    "there is nothing here to draw": "tidak ada yang bisa digambar di sini",
    "no nodes were defined": "tidak ada node yang didefinisikan",
    "could not read ": "tidak bisa membaca ",
    "this diagram has more than ": "diagram ini punya lebih dari ",
    " nodes": " node",
    "this diagram could not be drawn": "diagram ini tidak bisa digambar",

    /* ---- messages ---- */
    "Saved ": "Tersimpan ", "Opened ": "Dibuka ", "Imported ": "Diimpor ",
    "Closed ": "Ditutup ", "Replaced ": "Diganti ",
    "Could not save ": "Gagal menyimpan ", "Could not save: ": "Gagal menyimpan: ",
    "Could not read ": "Gagal membaca ", "Could not find ": "Gagal menemukan ",
    "Could not create file: ": "Gagal membuat berkas: ",
    "Could not use that folder: ": "Gagal memakai folder itu: ",
    "Deleted ": "Dihapus ",
    "Copied": "Disalin", "Copy failed": "Gagal menyalin",
    "Code copied": "Kode disalin", "HTML copied": "HTML disalin",
    "Mermaid source copied": "Sumber Mermaid disalin",
    "Duplicated": "Digandakan", "Refreshed": "Dimuat ulang",
    "Exported HTML": "HTML diekspor", "Backup downloaded": "Cadangan diunduh",
    "Folder closed": "Folder ditutup", "Document deleted": "Dokumen dihapus",
    "No matches": "Tidak ada yang cocok", "Nothing to save": "Tidak ada yang perlu disimpan",
    "No Markdown files found in that folder": "Tidak ada berkas Markdown di folder itu",
    "No Markdown or text files found": "Tidak ada berkas Markdown atau teks",
    "That file is not a valid backup": "Berkas itu bukan cadangan yang sah",
    "Could not read that folder": "Gagal membaca folder itu",
    "Could not reopen that folder": "Gagal membuka ulang folder itu",
    "Version history": "Riwayat versi",
    "Cancel": "Batal",
    "OK": "OK",
    "Close folder": "Tutup folder",
    "Close anyway": "Tutup saja",
    "Close all": "Tutup semua",
    "Update links": "Perbarui tautan",
    "Import": "Impor",
    "Version history…": "Riwayat versi…",
    "Restore this version": "Pulihkan versi ini",
    "Nothing to show history for": "Tidak ada riwayat untuk ditampilkan",
    "No earlier versions yet. They are saved as you pause while typing.": "Belum ada versi sebelumnya. Versi disimpan saat Anda berhenti mengetik sejenak.",
    "Current": "Saat ini",
    "characters": "karakter",
    "That editor is no longer the active one": "Editor itu sudah tidak aktif",
    "Restored the version from ": "Versi dipulihkan dari ",
    "Could not open that folder": "Gagal membuka folder itu",
    "Could not open the folder picker": "Gagal membuka pemilih folder",
    "Could not rename the file on disk": "Gagal mengganti nama berkas di disk",
    "Could not make a PNG": "Gagal membuat PNG",
    "Open a folder first to follow links between files":
      "Buka folder dulu agar tautan antar berkas bisa diikuti",
    "Browser storage unavailable - use Ctrl+S to save files":
      "Penyimpanan browser tidak tersedia - pakai Ctrl+S untuk menyimpan berkas",
    " is not in the opened folder": " tidak ada di folder yang terbuka",
    "Moving your documents...": "Memindahkan dokumen Anda...",
    "Documents are now in ": "Dokumen sekarang ada di ",
    " file moved": " berkas dipindahkan", " files moved": " berkas dipindahkan",
    "Nothing to save.": "Tidak ada yang perlu disimpan.",
    " (in the Recycle Bin)": " (ada di Recycle Bin)",

    /* ---- questions ---- */
    "New file name:": "Nama berkas baru:", "Link URL:": "URL tautan:",
    "Link text:": "Teks tautan:", "Image URL or path:": "URL atau lokasi gambar:",
    "Alt text:": "Teks alternatif:",
    "Image saved as ": "Gambar disimpan sebagai ",
    "Images saved: ": "Gambar disimpan: ",
    "Could not save the image: ": "Gambar tidak bisa disimpan: ",
    "Image not found: ": "Gambar tidak ditemukan: ",
    "Image embedded in the document - open a folder to keep pictures as files":
      "Gambar disematkan di dalam dokumen - buka folder agar gambar disimpan sebagai berkas",
    "Drop Markdown files to open, or pictures to insert":
      "Lepas berkas Markdown untuk dibuka, atau gambar untuk disisipkan",
    "Paste image": "Tempel gambar",
    "Pictures": "Gambar",
    "No preview for this kind of file": "Tidak ada pratinjau untuk jenis file ini",
    "Go to file": "Buka berkas",
    "Window": "Jendela", "Picture-in-picture": "Picture-in-picture",
    "Picture-in-picture (Ctrl+Alt+P)": "Picture-in-picture (Ctrl+Alt+P)",
    "A small window that stays on top of every other app, like Google Meet's, showing the document you are in - read it, or switch it to Edit and keep writing. Open it with the button in the top bar or Ctrl+Alt+P.":
      "Jendela kecil yang selalu tampil di atas aplikasi lain, seperti di Google Meet, berisi dokumen yang sedang Anda buka - baca, atau ganti ke Edit dan terus menulis. Buka lewat tombol di bar atas atau Ctrl+Alt+P.",
    "Picture-in-picture needs Edge or Chrome 116 or newer": "Picture-in-picture butuh Edge atau Chrome 116 ke atas",
    "Picture-in-picture is off - turn it on in Settings": "Picture-in-picture belum aktif - nyalakan di Pengaturan",
    "Picture-in-picture is on - open it with the button in the top bar or Ctrl+Alt+P":
      "Picture-in-picture aktif - buka lewat tombol di bar atas atau Ctrl+Alt+P",
    "Could not open the picture-in-picture window: ": "Jendela picture-in-picture tidak bisa dibuka: ",
    "This browser has no picture-in-picture for pages. It needs Edge or Chrome 116 or newer, which the desktop app uses.":
      "Browser ini tidak punya picture-in-picture untuk halaman. Butuh Edge atau Chrome 116 ke atas, yang dipakai aplikasi desktop.",
    "Back to Markdown Studio": "Kembali ke Markdown Studio", "Edit": "Edit", "Preview": "Pratinjau",
    "Write in this window": "Menulis di jendela ini", "Show the finished page": "Tampilkan hasil jadinya",
    "Command palette": "Palet perintah",
    "Search files by name - type > for commands, @ for headings, : for a line": "Cari berkas menurut nama - ketik > untuk perintah, @ untuk judul, : untuk baris",
    "Open": "Buka",
    "Reveal in File Explorer": "Tampilkan di File Explorer",
    "Copy Path": "Salin lokasi",
    "Copy Relative Path": "Salin lokasi relatif",
    "Rename…": "Ganti nama…",
    "New File…": "Berkas baru…",
    "Close": "Tutup",
    "Close Others": "Tutup yang lain",
    "Close All": "Tutup semua",
    "Copied": "Disalin",
    "Renamed to ": "Nama diganti menjadi ",
    "Deleted ": "Dihapus: ",
    "Could not rename: ": "Tidak bisa mengganti nama: ",
    "Could not delete: ": "Tidak bisa menghapus: ",
    "That is not a valid file name.": "Itu bukan nama berkas yang valid.",
    "A document has to keep a Markdown extension such as .md.": "Dokumen harus tetap berekstensi Markdown seperti .md.",
    "A file named ": "Berkas bernama ",
    " is already there.": " sudah ada.",
    "It goes to the Recycle Bin.": "Berkas akan masuk ke Recycle Bin.",
    "Update %n links in %m files to the new name?": "Perbarui %n tautan di %m berkas ke nama baru?",
    "Updated links in ": "Tautan diperbarui di ",
    "file": "berkas",
    "files": "berkas",
    "Line copied": "Baris disalin",
    "Line cut": "Baris dipotong",
    "Saved a copy as ": "Salinan disimpan sebagai ",
    "Downloaded ": "Diunduh: ",
    "HTML copied": "HTML disalin",
    "The key combination (%s) is not a command.": "Kombinasi tombol (%s) bukan sebuah perintah.",
    "was pressed. Waiting for second key of chord...": "ditekan. Menunggu tombol kedua...",
    "No headings in this document": "Dokumen ini tidak punya judul",
    "Go to line ": "Ke baris ",
    "Type a line number between 1 and ": "Ketik nomor baris antara 1 dan ",
    "No matching files": "Tidak ada berkas yang cocok",
    "The same keys as VS Code. Press Ctrl+Shift+P to search every command; a key the browser keeps for itself has a second one that always works.": "Tombol yang sama dengan VS Code. Tekan Ctrl+Shift+P untuk mencari semua perintah; tombol yang dipakai browser sendiri punya tombol kedua yang selalu berfungsi.",
    "File": "Berkas",
    "Go": "Navigasi",
    "View": "Tampilan",
    "Find": "Cari",
    "Editing": "Menyunting",
    "Formatting": "Format",
    "New document": "Dokumen baru",
    "Open file…": "Buka berkas…",
    "Open folder…": "Buka folder…",
    "Save": "Simpan",
    "Save as…": "Simpan sebagai…",
    "Save all": "Simpan semua",
    "Close editor": "Tutup editor",
    "Close all editors": "Tutup semua editor",
    "Close other editors": "Tutup editor lain",
    "Reopen closed editor": "Buka lagi editor yang ditutup",
    "Rename file": "Ganti nama berkas",
    "Copy path of active file": "Salin lokasi berkas aktif",
    "Copy relative path of active file": "Salin lokasi relatif berkas aktif",
    "Reveal active file in File Explorer": "Tampilkan berkas aktif di File Explorer",
    "Export as HTML": "Ekspor sebagai HTML",
    "Copy HTML to clipboard": "Salin HTML ke clipboard",
    "Duplicate as new document": "Duplikat sebagai dokumen baru",
    "Download backup (all docs)": "Unduh cadangan (semua dokumen)",
    "Import backup (.json)": "Impor cadangan (.json)",
    "New file in folder…": "Berkas baru di folder…",
    "Go to file…": "Buka berkas…",
    "Show all commands": "Tampilkan semua perintah",
    "Go to heading…": "Ke judul…",
    "Go to line…": "Ke baris…",
    "Next editor": "Editor berikutnya",
    "Previous editor": "Editor sebelumnya",
    "Move tab left": "Pindahkan tab ke kiri",
    "Move tab right": "Pindahkan tab ke kanan",
    "Copy Tab": "Salin Tab", "Paste Tab": "Tempel Tab",
    "Copy tab": "Salin tab", "Paste tab as a new document": "Tempel tab sebagai dokumen baru",
    "Tab copied - right-click an empty part of the tab bar to paste it":
      "Tab disalin - klik kanan bagian kosong di bar tab untuk menempelnya",
    "Pasted as ": "Ditempel sebagai ", " (copy)": " (salinan)",
    " picture(s) could not be copied": " gambar tidak bisa disalin",
    "Move to ": "Pindahkan ke ", "Moved to ": "Dipindahkan ke ", "Copied to ": "Disalin ke ",
    "Moved to Docs: ": "Dipindahkan ke Dokumen: ",
    "Copied to Docs (the original is read-only): ": "Disalin ke Dokumen (aslinya hanya-baca): ",
    "Could not move: ": "Tidak bisa memindahkan: ",
    "Open editor 1–9": "Buka editor 1–9",
    "Open last editor": "Buka editor terakhir",
    "Show Explorer": "Tampilkan Explorer",
    "Show Docs": "Tampilkan Docs",
    "Show Outline": "Tampilkan Outline",
    "Toggle sidebar": "Buka/tutup panel samping",
    "Preview to the side": "Pratinjau di samping",
    "Toggle preview": "Buka/tutup pratinjau",
    "Toggle word wrap": "Buka/tutup soft wrap",
    "Toggle wide layout": "Buka/tutup tata letak lebar",
    "Toggle sync scroll & selection": "Buka/tutup sinkronisasi gulir & pilihan",
    "Replace": "Ganti",
    "Find next": "Cari berikutnya",
    "Find previous": "Cari sebelumnya",
    "Select word / next occurrence": "Pilih kata / kemunculan berikutnya",
    "Select line": "Pilih baris",
    "Delete line": "Hapus baris",
    "Move line up": "Pindahkan baris ke atas",
    "Move line down": "Pindahkan baris ke bawah",
    "Copy line up": "Salin baris ke atas",
    "Copy line down": "Salin baris ke bawah",
    "Insert line below": "Sisipkan baris di bawah",
    "Insert line above": "Sisipkan baris di atas",
    "Indent line": "Jorokkan baris",
    "Outdent line": "Kurangi jorokan",
    "Toggle comment": "Buka/tutup komentar",
    "Cut line (nothing selected)": "Potong baris (tanpa pilihan)",
    "Copy line (nothing selected)": "Salin baris (tanpa pilihan)",
    "Undo / redo": "Urungkan / ulangi",
    "Bold": "Tebal",
    "Italic": "Miring",
    "Inline code": "Kode sebaris",
    "Insert link": "Sisipkan tautan",
    "Insert image": "Sisipkan gambar",
    "Paste image / URL as link": "Tempel gambar / URL sebagai tautan",
    "Heading up (bigger)": "Judul naik (lebih besar)",
    "Heading down (smaller)": "Judul turun (lebih kecil)",
    "Heading 1–6": "Judul 1–6",
    "Bullet list": "Daftar butir",
    "Numbered list": "Daftar bernomor",
    "Toggle task": "Centang/batal tugas",
    "Blockquote": "Kutipan",
    "Insert table": "Sisipkan tabel",
    "Insert code block": "Sisipkan blok kode",
    "Insert horizontal rule": "Sisipkan garis pemisah",
    "Insert footnote": "Sisipkan catatan kaki",
    "Continue list": "Lanjutkan daftar",
    "Close panel": "Tutup panel",
    "Welcome guide": "Panduan selamat datang",
    "Something went wrong: ": "Terjadi kesalahan: ",
    "Opened the latest Welcome guide": "Panduan selamat datang terbaru dibuka",
    "in ": "di ",
    "not used in any document": "tidak dipakai di dokumen mana pun",
    "Loading...": "Memuat...",
    "Copy path": "Salin lokasi",
    "Path copied": "Lokasi disalin",
    "Insert into document": "Sisipkan ke dokumen",
    "Open a document from the same folder to insert this picture":
      "Buka dokumen dari folder yang sama untuk menyisipkan gambar ini",
    "Delete": "Hapus",
    "has unsaved changes. Close it anyway?":
      "punya perubahan yang belum tersimpan. Tetap ditutup?",
    "%n open files have unsaved changes. Close all tabs anyway?":
      "%n berkas terbuka punya perubahan yang belum tersimpan. Tetap tutup semua tab?",
    "Import %n document(s) from this backup?":
      "Impor %n dokumen dari cadangan ini?",
    "Ctrl+S writes them to ": "Ctrl+S menulisnya ke ",
    " goes to the Recycle Bin.": " akan masuk ke Recycle Bin.",
    "This cannot be undone.": "Tindakan ini tidak bisa dibatalkan.",
    "Some open files have unsaved changes. Close the folder anyway?":
      "Ada berkas terbuka yang belum tersimpan. Tetap tutup foldernya?"
  };

  let lang = "en";

  /* "auto" follows whatever the window was opened in - which on a machine set to
     Indonesian is Indonesian, without anybody having to find the setting. */
  function resolve(want) {
    if (want === "id" || want === "en") return want;
    let nav = "";
    try { nav = (navigator.language || navigator.userLanguage || "").toLowerCase(); }
    catch (e) { }
    return nav.indexOf("id") === 0 || nav.indexOf("in") === 0 ? "id" : "en";
  }

  function set(want) { lang = resolve(want); return lang; }
  function tr(s) {
    if (lang !== "id") return s;
    const v = ID[s];
    return v === undefined ? s : v;
  }
  return { tr: tr, set: set, cur: () => lang, resolve: resolve };
})();
const tr = I18N.tr;

