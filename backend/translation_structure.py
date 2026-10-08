"""Locate prose brackets and author/year citations outside PDF math tokens."""
import re

STYLE = re.compile(r"</?style(?: id='\d+')?>")


def visible(text):
    return STYLE.sub('', text)


def styled_slice(source, start, end):
    """Cut at a prose boundary while closing/reopening the active style.

    PDF color runs commonly put '(' and ')' in different runs from an author
    name. Each resulting fragment remains valid markup with the same style IDs.
    """
    def active(position):
        stack=[]
        for match in STYLE.finditer(source):
            if match.end()>position:break
            if match[0].startswith('</'):
                if stack:stack.pop()
            else:stack.append(match[0])
        return stack
    value=''.join(active(start))+source[start:end]+'</style>'*len(active(end))
    return re.sub(r"<style id='\d+'></style>",'',value)


def citation(text, tail=False):
    text=visible(text).strip()
    if len(text)>600 or '{v' in text:
        return False
    if tail:
        return bool(re.fullmatch(r'et\s+al\.,\s*(?:19|20)\d{2}[a-z]?(?:,\s*(?:Lemma|Theorem|Section|Proposition|Corollary|Eq\.?|pp?\.)\s+[\w.\-–]+)?',text,re.I))
    parts=text.split(';')
    return all(re.fullmatch(r'(?:see\s+|e\.g\.,?\s*)?[A-ZÀ-Ž][^\d(){}]{1,100},\s*(?:19|20)\d{2}[a-z]?(?:,\s*(?:Lemma|Theorem|Section|Proposition|Corollary|Eq\.?|pp?\.)\s+[\w.\-–]+)?',part.strip()) for part in parts)


def protected_ranges(source):
    """Yield nonoverlapping (start,end,inner) groups; inner=None is literal.

    A bracket can continue across columns/paragraphs. Preserve unmatched ends
    rather than inventing a partner. Do not split style tags across groups.
    """
    start=0
    # A citation continued from the preceding column, with its closing marker.
    close=source.find(')')
    if close>=0 and '(' not in source[:close] and citation(source[:close],tail=True):
        end=close+1
        if source[end:end+1]=='.':end+=1
        yield 0,end,None
        start=end
    pairs={')':'(',']':'['}
    stack=[]
    groups=[]
    for i in range(start,len(source)):
        c=source[i]
        if c in '([':
            stack.append((c,i))
        elif c in pairs:
            if stack and stack[-1][0]==pairs[c]:
                _,a=stack.pop()
                if not stack:
                    inner=source[a+1:i]
                    literal=citation(inner) or not re.search(r'[A-Za-z]{2}',visible(inner)) or bool(re.fullmatch(r'[A-Z][A-Z\d-]{1,14}',visible(inner)))
                    end=i+1
                    if citation(inner) and source[end:end+1]=='.':
                        end+=1
                    groups.append((a,end,None if literal else inner))
            elif not stack:
                groups.append((i,i+1,None))
    if stack:
        # Includes any nested matched group inside an unmatched outer opening.
        first=stack[0][1]
        remainder=visible(source[first+1:]).strip()
        if re.fullmatch(r"[A-ZÀ-Ž][A-Za-zÀ-ž'’-]+(?:\s+et\s+al\.?)?",remainder):
            groups.append((first,len(source),None))
        else:
            groups.extend((j,j+1,None) for j in range(first,len(source)) if source[j] in '()[]')
    yield from sorted(groups)
