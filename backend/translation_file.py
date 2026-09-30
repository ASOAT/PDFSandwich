"""Atomically maintain a side-by-side translation file without rewriting sources."""
import os
import shutil
import uuid
from pathlib import Path
import pymupdf as fitz


def sync_translation(source_path, translated_pages, annotations, output,
                     expected_source_stamp, expected_output_stamp=None,
                     changed_pages=None, compact=False):
    from pdf_ops import require_pdf, stamp, validate_annotation, add_annotation, PREFIX
    source_path, output = Path(source_path).resolve(), Path(output).resolve()
    if source_path == output or (output.exists() and os.path.samefile(source_path,output)):
        raise ValueError('译文不能覆盖原 PDF。')
    if source_path.parent != output.parent:
        raise ValueError('自动保存的译文必须与库内原文位于同一文件夹。')
    if stamp(source_path) != expected_source_stamp:
        raise ValueError('原 PDF 已被其他程序修改，请重新打开后再保存译文。')
    exists = output.exists()
    if exists and (expected_output_stamp is None or stamp(output) != expected_output_stamp):
        raise ValueError('译文文件已存在或被其他程序修改，未覆盖。请保留该文件并选择另存副本。')
    if not exists and expected_output_stamp is not None:
        raise ValueError('译文文件已被移动或删除，请选择重新保存副本。')
    temporary = output.with_name('.'+output.stem+'.'+uuid.uuid4().hex+'.tmp.pdf')
    compacted = temporary.with_suffix('.compact.pdf')
    try:
        with require_pdf(source_path) as source:
            for item in annotations: validate_annotation(item,len(source))
            pages = list(range(len(source))) if not exists else sorted(set(changed_pages or []))
            if any(not isinstance(p,int) or not 0<=p<len(source) for p in pages): raise ValueError('译文页码无效。')
            shutil.copyfile(output if exists else source_path,temporary)
            with require_pdf(temporary) as result:
                if len(result)!=len(source): raise ValueError('译文与原文页数不一致，请另存副本。')
                by_page={}
                for item in annotations: by_page.setdefault(item['page'],[]).append(item)
                for index in pages:
                    translated=translated_pages.get(str(index))
                    if translated:
                        with require_pdf(translated) as part:
                            if len(part)!=1: raise ValueError('缓存译文应只有一页。')
                            result.insert_pdf(part,from_page=0,to_page=0,start_at=index+1,annots=False)
                        result.delete_page(index)
                    elif exists:
                        result.insert_pdf(source,from_page=index,to_page=index,start_at=index+1,annots=True)
                        result.delete_page(index)
                    page=result[index]
                    # On untranslated pages, retain unsupported annotations;
                    # supported native marks already have current draft entries.
                    from pdf_ops import read_annotation
                    for annot in list(page.annots() or []):
                        if read_annotation(annot,index) or annot.info.get('subject','').startswith(PREFIX): page.delete_annot(annot)
                    for item in by_page.get(index,[]): add_annotation(page,item,'zh' if translated else 'en')
                result.set_toc(source.get_toc())
                if compact or not result.can_save_incrementally(): result.save(compacted,garbage=3,deflate=True)
                else: result.saveIncr()
        if stamp(source_path)!=expected_source_stamp: raise ValueError('保存期间原 PDF 发生变化，已取消替换。')
        if exists:
            if not output.exists() or stamp(output)!=expected_output_stamp: raise ValueError('保存期间译文被其他程序修改，已取消替换。')
        elif output.exists(): raise ValueError('同名文件已出现，未覆盖。')
        completed = compacted if compacted.exists() else temporary
        if exists:
            os.replace(completed,output)
        else:
            # Exclusive publication: a file appearing during the save is never replaced.
            if os.name == 'nt': os.rename(completed,output)
            else: os.link(completed,output)
        return {'path':str(output),'stamp':stamp(output),'updatedPages':len(pages)}
    finally:
        temporary.unlink(missing_ok=True); compacted.unlink(missing_ok=True)
